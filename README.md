# OpenChess

Chess, in your terminal.

A TUI chess game with a local two-player mode, 20+ themes, and an HTTP API for
the online modes.

## Requirements

- [Bun](https://bun.sh) 1.3 or newer

## Setup

```sh
bun install
cp .env.example .env
```

The server reads `.env` from the directory you launch it from, and refuses to
start if a variable is missing or malformed. Copying the example is enough to
run it locally.

| Variable              | Required | Default       | Notes                                           |
| --------------------- | -------- | ------------- | ----------------------------------------------- |
| `NODE_ENV`            | no       | `development` | `production` hides error details from responses |
| `PORT`                | no       | `9999`        | `.env.example` sets `3000`                      |
| `LOG_LEVEL`           | yes      | —             | `fatal`…`trace`, or `silent`                    |
| `DATABASE_URL`        | yes      | —             | e.g. `file:dev.db`                              |
| `DATABASE_AUTH_TOKEN` | in prod  | —             | required when `NODE_ENV=production`             |

## Running

```sh
bun run dev:cli      # the game
bun run dev:server   # the API, on http://localhost:3000
```

Interactive API docs are served at `/reference`, and the raw OpenAPI document at
`/doc`.

## Playing

Pick a mode from the menu with `↑↓` and `enter`, or press `1`–`3`. `ctrl + .`
opens the theme picker, and `q` quits.

At the board:

| Key            | Action                                    |
| -------------- | ----------------------------------------- |
| `↑↓←→`, `hjkl` | Move the cursor                           |
| `enter`        | Pick a piece up, or play the move         |
| `esc`          | Cancel the selection, then leave the game |
| `u`            | Take the last move back                   |
| `r`            | Start a new game                          |
| `f`            | Flip the board                            |

Selecting a piece dots the squares it may move to and highlights the pieces it
may capture. Promotions prompt for `Q`, `R`, `B`, or `N`.

All the rules are enforced: castling, en passant, promotion, checkmate,
stalemate, the fifty-move rule, threefold repetition, and insufficient material.

## API errors

Every response with an unsuccessful status is
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details, served as
`application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "detail": "No route matched GET /nope",
  "instance": "/nope",
  "requestId": "cf130122-f1b1-43f6-beb5-720a8693abfe"
}
```

`requestId` matches the `x-request-id` header and the server log line, so a
report from a client can be traced to what actually happened.

Validation failures add an `errors` array naming each offending field, and carry
`"type": "/problems/validation-error"`:

```json
{
  "type": "/problems/validation-error",
  "title": "Validation Failed",
  "status": 422,
  "detail": "The json does not match the expected schema",
  "instance": "/players",
  "errors": [
    {
      "path": "name",
      "message": "Too small: expected string to have >=3 characters",
      "code": "too_small"
    },
    {
      "path": "rating",
      "message": "Invalid input: expected number, received undefined",
      "code": "invalid_type"
    }
  ]
}
```

Unhandled server errors return a bare `500` in production. Outside production
they also include the error's `detail` and `stack`, which is convenient locally
and would leak internals if it ever shipped — so keep `NODE_ENV=production` set
in production.

## Development

```sh
bun test        # engine, screens, and API error handling
bun run typecheck
```

The chess engine is verified with [perft](https://www.chessprogramming.org/Perft)
against the standard positions, so move generation can be trusted before
anything is built on top of it.
