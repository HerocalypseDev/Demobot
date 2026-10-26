import { Client, GatewayIntentBits, Events, MessageFlags } from 'discord.js';
import modules from './modules/index.js';
import { colors, sendLog } from './util.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ],
});
client.modules = modules;

const byCommand = new Map();
const byName = new Map();
for (const m of modules) {
  byName.set(m.name, m);
  for (const c of m.commands ?? []) byCommand.set(c.name, m);
  for (const [event, fn] of Object.entries(m.events ?? {})) {
    client.on(event, (...args) => fn(...args).catch(err => console.error(`[${m.name}:${event}]`, err)));
  }
}

client.on(Events.InteractionCreate, async i => {
  try {
    if (i.isChatInputCommand()) await byCommand.get(i.commandName)?.onCommand(i);
    else if (i.isMessageComponent() || i.isModalSubmit()) {
      const [name, action, ...args] = i.customId.split(':');
      await byName.get(name)?.onComponent?.(i, action, args);
    }
  } catch (err) {
    console.error(err);
    if (i.isRepliable()) {
      const reply = { content: 'Something went wrong. The error has been logged.', flags: MessageFlags.Ephemeral };
      await (i.replied || i.deferred ? i.followUp(reply) : i.reply(reply)).catch(() => {});
    }
    if (i.guild) await sendLog(i.guild, { title: 'Error', color: colors.error, description: '```' + String(err.stack).slice(0, 3900) + '```' });
  }
});

client.once(Events.ClientReady, c => {
  console.log(`Logged in as ${c.user.tag} in ${c.guilds.cache.size} server(s).`);
  setInterval(() => {
    for (const m of modules) m.tick?.(c).catch(err => console.error(`[${m.name}:tick]`, err));
  }, 30_000);
});

process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

client.login(process.env.DISCORD_TOKEN);
