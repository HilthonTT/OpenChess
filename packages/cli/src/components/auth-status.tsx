import { useAuth } from "../providers/auth";
import { useTheme, useUITheme } from "../providers/theme";

/**
 * The account pill under the title. It answers "am I signed in, and as who?"
 * without the user having to open anything, which is what makes the sign in /
 * sign out row further down read as an obvious next step.
 */
export function AuthStatus() {
  const ui = useUITheme();
  const { colors } = useTheme();
  const { status, profile } = useAuth();

  const chip = {
    checking: {
      dot: "◌",
      dotColor: colors.thinking,
      label: "Checking your session",
      name: null,
    },
    "signing-in": {
      dot: "◌",
      dotColor: colors.thinking,
      label: "Waiting for your browser",
      name: null,
    },
    "signed-in": {
      dot: "●",
      dotColor: colors.success,
      // Signed in but the server never answered: we know we hold a token, we
      // just don't know whose it is. Say that rather than inventing a name.
      label: profile ? "Signed in as" : "Signed in",
      name: profile ? profile.username : null,
    },
    "signed-out": {
      dot: "○",
      dotColor: ui.faint,
      label: "Not signed in",
      name: null,
    },
  }[status];

  return (
    <box
      flexDirection="row"
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={ui.selectionBg}
    >
      <text>
        <span fg={chip.dotColor}>{chip.dot}</span>
        <span fg={ui.dim}>{` ${chip.label}`}</span>
        {chip.name ? (
          <span fg={ui.cream}>
            <b>{` ${chip.name}`}</b>
          </span>
        ) : null}
        {status === "signed-out" ? (
          <span fg={ui.faint}>{" · online play needs an account"}</span>
        ) : null}
      </text>
    </box>
  );
}
