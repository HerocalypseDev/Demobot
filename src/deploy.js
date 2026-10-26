import { REST, Routes } from 'discord.js';
import modules from './modules/index.js';

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
const body = modules.flatMap(m => m.commands ?? []).map(c => c.toJSON());
const route = GUILD_ID ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) : Routes.applicationCommands(CLIENT_ID);

await new REST().setToken(DISCORD_TOKEN).put(route, { body });
console.log(`Registered ${body.length} commands ${GUILD_ID ? `to server ${GUILD_ID}` : 'globally'}.`);
