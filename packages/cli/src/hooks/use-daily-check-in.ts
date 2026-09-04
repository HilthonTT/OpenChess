import { useEffect } from "react";
import { checkIn } from "../lib/profile";
import { useAuth } from "../providers/auth";
import { useToast } from "../providers/toast";

let claimedThisSession = false;

const STREAK_TOAST_MS = 6000;

export function useDailyCheckIn(): void {
  const auth = useAuth();
  const toast = useToast();

  useEffect(() => {
    if (auth.status !== "signed-in" || claimedThisSession) {
      return;
    }

    claimedThisSession = true;

    let cancelled = false;

    void checkIn()
      .then((result) => {
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
        claimedThisSession = false;
      });

    return () => {
      cancelled = true;
    };
  }, [auth.status, toast]);
}
