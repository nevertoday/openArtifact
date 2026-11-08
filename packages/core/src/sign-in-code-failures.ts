/** Wrong sign-in codes typed for an address, by time. The cap on them lives with sign-in, not here. */
export interface SignInCodeFailures {
  /** Notes one wrong code at `at` (epoch ms), and may drop this address's failures from before `forgetBefore`. */
  record(email: string, at: number, forgetBefore: number): Promise<void>
  countSince(email: string, since: number): Promise<number>
}
