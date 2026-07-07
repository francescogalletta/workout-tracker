/**
 * Auth seam shared by `SignIn` (the 3-step UI) and `InstantSync`. Node-safe: no
 * InstantDB import here, so the local/test path never pulls in the SDK.
 * `InstantSync` builds an `AuthApi` from `idb.auth` and hands it to `SignIn`
 * via `Shell`; with no app id `SignIn` receives none and shows a quiet
 * "sync unavailable" note instead of a sign-in flow.
 */
export interface AuthApi {
  sendMagicCode(email: string): Promise<void>
  signInWithMagicCode(email: string, code: string): Promise<void>
}
