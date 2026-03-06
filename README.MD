# Tournament Bot

A Discord bot for managing tournaments with brackets, leaderboards, and multiple tournament formats.

## Features

- Multiple tournament formats — Round Robin, Single Elimination, Double Elimination
- Auto-generated brackets
- Live leaderboard tracking
- Custom tournament configuration via form

## Commands

| Command | Description |
|---------|-------------|
| `/create` | Create a new tournament with a custom configuration form |
| `/tournaments` | List all tournaments in the server |
| `/tournament-info <tournamentId>` | View details of a specific tournament |
| `/match <tournamentId>` | Check your upcoming or current match |
| `/disqualify` | Disqualify a participant from a tournament |

## Tournament Formats

- **Round Robin** — Every participant plays against each other
- **Single Elimination** — Lose once and you're out
- **Double Elimination** — Two losses to be eliminated

## Setup

```bash
git clone https://github.com/yourusername/tournament-bot.git
cd tournament-bot
npm install
```

Create a `.env` file in the root directory:

```env
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_application_client_id
```

Deploy slash commands then start the bot:

```bash
npm run deploy   # register slash commands
npm start        # start the bot
```

## Requirements

- Node.js 18+
- Discord.js v14
- A Discord bot token from the [Developer Portal](https://discord.com/developers/applications)
