import { GameScreen } from "../../components/game-screen";
import { useAuth } from "../../providers/auth";
import { useUITheme } from "../../providers/theme";
import { LocalAIGame } from "./local";
import { ServerAIGame } from "./server";

export function AIGame() {
  const auth = useAuth();

  if (auth.status === "checking") {
    return <CheckingSession />;
  }

  if (auth.status === "signed-in") {
    return <ServerAIGame />;
  }

  return <LocalAIGame subtitle="Offline play — sign in to earn rewards" />;
}

function CheckingSession() {
  const theme = useUITheme();

  return (
    <GameScreen
      title="Play vs AI"
      subtitle="Test your skill against the engine"
    >
      <text fg={theme.dim}>Checking your session…</text>
    </GameScreen>
  );
}
