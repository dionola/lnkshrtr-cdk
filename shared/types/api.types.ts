export interface UserResponse {
  id: string;
  username: string;
  email: string;
  createdAt: Date;
}

export interface LinkResponse {
  id: string;
  shortCode: string;
  originalUrl: string;
  title: string | null;
  isPublic: boolean;
  isActive: boolean;
  isPasswordProtected: boolean;
  userId: string | null;
  type: string;
  visits: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthResponse {
  user: UserResponse;
  accessToken: string;
}

export interface AuthorizerContext {
  userId: string;
  username: string;
  email: string;
}
