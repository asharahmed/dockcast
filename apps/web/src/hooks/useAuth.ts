/**
 * `useMe` query + login/register/logout mutations. ui-spec.md §1 `hooks/useAuth.ts`.
 */
import { useMe, useLogin, useLogout, useRegister } from '../api/queries.js';

export function useAuth() {
  const meQuery = useMe();
  const login = useLogin();
  const register = useRegister();
  const logout = useLogout();

  return {
    user: meQuery.data?.user ?? null,
    isLoading: meQuery.isLoading,
    login,
    register,
    logout,
  };
}
