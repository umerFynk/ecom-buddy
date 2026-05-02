import { Router } from 'express';
import { z } from 'zod';
import { ok, created } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireAdminAuth } from '@/middleware/auth';
import {
  createChannel, joinChannel, leaveChannel, listChannelMessages, listChannels,
  listDm, listDmThreads, pinMessage, postChannelMessage, sendDm,
} from './internalChat.service';
import { getIo } from '../cs/cs.socket';
import { prisma } from '@/db/prisma';
import { NotFoundError } from '@/lib/errors';

export const internalChatRouter = Router();
internalChatRouter.use(requireAdminAuth);

// ---- Channels ----

internalChatRouter.get(
  '/channels',
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    const items = await listChannels({ adminId: req.auth.adminId });
    return ok(res, items);
  })
);

const CreateChannelSchema = z.object({
  name: z.string().min(1).max(60).regex(/^[a-z0-9_-]+$/, 'lowercase letters, digits, hyphen, underscore only'),
  description: z.string().max(200).optional(),
  isPrivate: z.boolean().default(false),
});

internalChatRouter.post(
  '/channels',
  validate(CreateChannelSchema),
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    const c = await createChannel({ ...req.body, createdById: req.auth.adminId });
    return created(res, c);
  })
);

internalChatRouter.post(
  '/channels/:id/join',
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    await joinChannel({ channelId: req.params.id!, adminId: req.auth.adminId });
    return ok(res, { joined: true });
  })
);

internalChatRouter.post(
  '/channels/:id/leave',
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    await leaveChannel({ channelId: req.params.id!, adminId: req.auth.adminId });
    return ok(res, { left: true });
  })
);

internalChatRouter.get(
  '/channels/:id/messages',
  asyncHandler(async (req, res) => {
    const items = await listChannelMessages({ channelId: req.params.id!, limit: 100 });
    return ok(res, items);
  })
);

const PostMsgSchema = z.object({ content: z.string().min(1).max(4000) });

internalChatRouter.post(
  '/channels/:id/messages',
  validate(PostMsgSchema),
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    const channel = await prisma.internalChannel.findUnique({ where: { id: req.params.id! } });
    if (!channel) throw new NotFoundError('Channel not found');
    const msg = await postChannelMessage({
      channelId: req.params.id!,
      senderId: req.auth.adminId,
      content: req.body.content,
    });
    const io = getIo();
    if (io) io.to('admin:internal').emit('internal:message:new', { channelId: req.params.id, message: msg });
    return created(res, msg);
  })
);

internalChatRouter.post(
  '/messages/:id/pin',
  asyncHandler(async (req, res) => {
    const msg = await pinMessage(req.params.id!, true);
    return ok(res, msg);
  })
);

internalChatRouter.post(
  '/messages/:id/unpin',
  asyncHandler(async (req, res) => {
    const msg = await pinMessage(req.params.id!, false);
    return ok(res, msg);
  })
);

// ---- DMs ----

internalChatRouter.get(
  '/dm/threads',
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    const items = await listDmThreads({ adminId: req.auth.adminId });
    return ok(res, items);
  })
);

internalChatRouter.get(
  '/dm/:peerId',
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    const items = await listDm({ adminId: req.auth.adminId, peerId: req.params.peerId! });
    return ok(res, items);
  })
);

internalChatRouter.post(
  '/dm/:peerId',
  validate(PostMsgSchema),
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    const msg = await sendDm({ senderId: req.auth.adminId, recipientId: req.params.peerId!, content: req.body.content });
    const io = getIo();
    if (io) {
      io.to('admin:internal').emit('internal:dm:new', { peerId: req.params.peerId, message: msg, fromAdminId: req.auth.adminId });
    }
    return created(res, msg);
  })
);
