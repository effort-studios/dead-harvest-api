// Sessão recém-criada: o token vai para o cookie (nunca é guardado em claro) e expiresAt define a validade dele
export type AuthSession = { token: string; expiresAt: Date };
