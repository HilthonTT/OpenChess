import { useEffect } from "react";
import { checkIn } from "../lib/profile";
import { useAuth } from "../providers/auth";
import { useToast } from "../providers/toast";

/**
 * Claim the daily streak, once per run of the program.
 *
 * Module state rather than a ref, for the same reason the menu's cursor is:
 * the router unmounts Home whenever a screen is open, so a ref would reset and
 * the claim would re-fire on every trip back to the menu. The request itself is
 * idempotent per day and a repeat would cost nothing — but it would also toast
 * again, and a toast is only worth showing while it is still news.
 */
let claimedThisSession = false;

/** How long the streak toast stays up. Longer than the default: it reports a
 * payout, and a player who looks up a second late should still catch it. */
const STREAK_TOAST_MS = 6000;

export function useDailyCheckIn(): void {
  const auth = useAuth();
  const toast = useToast();

  useEffect(() => {
    if (auth.status !== "signed-in" || claimedThisSession) {
      return;
    }

    // Set before awaiting, not after: two renders in the same tick would
    // otherwise both pass the check and fire two requests.
    claimedThisSession = true;

    let cancelled = false;

    void checkIn()
      .then((result) => {
        // Nothing to announce when today was already claimed — which is every
        // launch after the first each day, so silence is the common case.
        if (cancelled || !result.claimed) {
          return;
        }

        const day = `Day ${result.current}`;
        const paid = `+${result.reward.xp} xp, +${result.reward.coins} coins`;
        const earned = result.unlocked
          .map((achievement) => achievement.name)
          .join(", ");

        toast.show({
          message: earned
            ? `${day} streak — ${paid} · unlocked ${earned}`
            : `${day} streak — ${paid}`,
          variant: "success",
          duration: STREAK_TOAST_MS,
        });
      })
      .catch(() => {
        // Not worth interrupting anyone over: the day stays claimable until
        // midnight UTC, so the next launch simply tries again. Releasing the
        // latch is what makes that retry possible within this run too.
        claimedThisSession = false;
      });

    return () => {
      cancelled = true;
    };
  }, [auth.status, toast]);
}
