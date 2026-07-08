import { useKeyboard, useRenderer } from "@opentui/react";
import { Header } from "../components/header";
import { Menu, type MenuItem } from "../components/menu";
import { theme } from "../theme";

const GAME_MODES: MenuItem[] = [
  {
    id: "local",
    icon: "♟",
    title: "Local 1v1",
    description: "Two players sharing one keyboard",
  },
  {
    id: "online",
    icon: "♞",
    title: "Online 1v1",
    description: "Challenge a player over the network",
  },
  {
    id: "ai",
    icon: "♛",
    title: "Play vs AI",
    description: "Test your skill against the engine",
  },
];

export function Home() {
  const renderer = useRenderer();

  useKeyboard((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      renderer.destroy();
      process.exit(0);
    }
  });

  const handleSelect = (_item: MenuItem) => {
    // TODO: navigate to the game screen for _item.id once it exists
  };

  return (
    <box
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      flexGrow={1}
      gap={2}
      position="relative"
      width="100%"
      height="100%"
    >
      <Header />
      <Menu items={GAME_MODES} onSelect={handleSelect} />
      <text>
        <span fg={theme.cream}>↑↓</span>
        <span fg={theme.faint}> move   </span>
        <span fg={theme.cream}>enter</span>
        <span fg={theme.faint}> select   </span>
        <span fg={theme.cream}>1-3</span>
        <span fg={theme.faint}> quick pick   </span>
        <span fg={theme.cream}>q</span>
        <span fg={theme.faint}> quit</span>
      </text>
    </box>
  );
}
