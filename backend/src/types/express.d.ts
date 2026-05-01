import { ResellerRole, AdminRole, ApiKeyScope } from '@prisma/client';

declare global {
  namespace Express {
    interface AuthContextReseller {
      type: 'reseller';
      tenantId: string;
      userId: string;
      role: ResellerRole;
    }

    interface AuthContextAdmin {
      type: 'admin';
      adminId: string;
      role: AdminRole;
    }

    interface AuthContextApiKey {
      type: 'api_key';
      tenantId: string;
      apiKeyId: string;
      scope: ApiKeyScope;
    }

    type AuthContext = AuthContextReseller | AuthContextAdmin | AuthContextApiKey;

    interface Request {
      auth?: AuthContext;
      tenantId?: string;
    }
  }
}

export {};
