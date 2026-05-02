import { Server as HttpServer } from 'http';
import { Server as IoServer, Socket } from 'socket.io';
import { env } from '@/config/env';
import { logger } from '@/lib/logger';
import { verifyJwt, ResellerJwtPayload, AdminJwtPayload } from '@/lib/jwt';

/**
 * Socket.io server attached to the existing HTTP server. JWT authentication
 * during the handshake (auth.token). On connect, sockets join rooms scoped to
 * their tenant (resellers) or to the global "admin:cs" room (CS agents).
 *
 * Rooms:
 *   tenant:{tenantId}     — reseller dashboards subscribe to their own tenant
 *   admin:cs              — admin CS agents see cross-tenant cs_message events
 *   conv:{conversationId} — clients watching a single conversation thread
 *
 * Emit events (server → client):
 *   cs:message:new        { conversationId, tenantId, message }
 *   cs:conversation:upd   { conversationId, tenantId, status, isAiHandling }
 *   internal:message:new  { channelId, message }    (Phase 7 will add this)
 */

let io: IoServer | undefined;

export function attachSocketIo(http: HttpServer): IoServer {
  if (io) return io;
  io = new IoServer(http, {
    cors: {
      origin: [env.RESELLER_PORTAL_URL, env.ADMIN_PANEL_URL, env.TRACKING_PAGE_URL],
      credentials: true,
    },
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  io.use((socket, next) => {
    try {
      const token = (socket.handshake.auth?.token ?? socket.handshake.query?.token) as string | undefined;
      if (!token) return next(new Error('missing token'));
      const payload = verifyJwt<ResellerJwtPayload | AdminJwtPayload>(token);
      socket.data.auth = payload;
      return next();
    } catch (err) {
      logger.warn({ err }, 'socket_auth_failed');
      return next(new Error('invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const auth = socket.data.auth as ResellerJwtPayload | AdminJwtPayload | undefined;
    if (!auth) {
      socket.disconnect(true);
      return;
    }
    if (auth.type === 'reseller') {
      socket.join(`tenant:${auth.tenantId}`);
    } else if (auth.type === 'admin') {
      socket.join('admin:cs');
      socket.join('admin:internal');
    }

    socket.on('cs:join', (conversationId: string) => {
      socket.join(`conv:${conversationId}`);
    });
    socket.on('cs:leave', (conversationId: string) => {
      socket.leave(`conv:${conversationId}`);
    });
  });

  return io;
}

export function getIo(): IoServer | undefined {
  return io;
}

/**
 * Helper used by services to broadcast new CS messages without needing to
 * import the io instance everywhere.
 */
export function emitCsMessageNew(payload: { conversationId: string; tenantId: string; message: unknown }) {
  if (!io) return;
  io.to(`tenant:${payload.tenantId}`).emit('cs:message:new', payload);
  io.to(`conv:${payload.conversationId}`).emit('cs:message:new', payload);
  io.to('admin:cs').emit('cs:message:new', payload);
}

export function emitCsConversationUpdate(payload: { conversationId: string; tenantId: string; status?: string; isAiHandling?: boolean; assignedToAdminId?: string | null }) {
  if (!io) return;
  io.to(`tenant:${payload.tenantId}`).emit('cs:conversation:upd', payload);
  io.to(`conv:${payload.conversationId}`).emit('cs:conversation:upd', payload);
  io.to('admin:cs').emit('cs:conversation:upd', payload);
}
