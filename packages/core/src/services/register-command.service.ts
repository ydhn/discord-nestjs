import { Collection } from '@discordjs/collection';
import { Injectable, Logger, Type } from '@nestjs/common';
import {
  ApplicationCommand,
  ApplicationCommandData,
  Client,
  FetchApplicationCommandOptions,
  GuildResolvable,
  Message,
  Snowflake,
} from 'discord.js';

import { InjectDiscordClient } from '../decorators/client/inject-discord-client.decorator';
import { DiscordModuleOption } from '../definitions/interfaces/discord-module-options';
import { RegisterCommandOptions } from '../definitions/interfaces/register-command-options';
import { SlashCommandPermissions } from '../definitions/interfaces/slash-command-permissions';
import { DiscordCommandProvider } from '../providers/discord-command.provider';
import { OptionService } from './option.service';

@Injectable()
export class RegisterCommandService {
  private readonly logger = new Logger(RegisterCommandService.name);

  constructor(
    private readonly discordCommandProvider: DiscordCommandProvider,
    @InjectDiscordClient()
    private readonly client: Client,
    private readonly discordOptionService: OptionService,
  ) {}

  async listen(): Promise<void> {
    const options = this.discordOptionService.getClientData();

    this.client.on('ready', () =>
      this.listenRegisterCommands(this.client, options),
    );
  }

  async registerCommands(
    commandOptions?: RegisterCommandOptions,
    slashCommandsPermissions?: SlashCommandPermissions[],
  ): Promise<void> {
    const client = this.client;
    const commands = this.discordCommandProvider.getAllCommands();

    if (commands.size === 0) return;

    const commandList = Array.from(commands.values());

    if (!client.application?.owner) await client.application?.fetch();

    const registeredCommands = await this.setupCommands(
      commandList,
      commandOptions,
    );

    if (slashCommandsPermissions)
      await this.setPermissions(
        registeredCommands,
        commands,
        slashCommandsPermissions,
      );
  }

  private async listenRegisterCommands(
    client: Client,
    { registerCommandOptions, slashCommandsPermissions }: DiscordModuleOption,
  ): Promise<void> {
    const commands = this.discordCommandProvider.getAllCommands();

    if (commands.size === 0) return;

    const commandList = Array.from(commands.values());

    if (!client.application?.owner) await client.application?.fetch();

    await Promise.all(
      registerCommandOptions.map(
        async (commandOptions: RegisterCommandOptions) => {
          const { forGuild, allowFactory } = commandOptions;
          if (allowFactory) {
            if (forGuild) {
              // Registering commands for specific guild
              client.on('messageCreate', async (message: Message) => {
                if (!allowFactory(message, commandList)) return;

                await this.registerCommands(
                  commandOptions,
                  slashCommandsPermissions,
                );
              });
            } else {
              // Registering global commands
              client.on('messageCreate', async (message: Message) => {
                if (!allowFactory(message, commandList)) return;

                await this.registerCommands(
                  commandOptions,
                  slashCommandsPermissions,
                );
              });
            }
          } else if (forGuild) {
            // Registering commands for specific guild
            await this.registerCommands(
              commandOptions,
              slashCommandsPermissions,
            );
          } else {
            // Registering global commands
            await this.registerCommands(
              commandOptions,
              slashCommandsPermissions,
            );
          }
        },
      ),
    );
  }

  private async dropMissingCommands(
    existCommands: Collection<string, ApplicationCommand>,
    commandList: ApplicationCommandData[],
  ): Promise<void> {
    const deleteCommands = existCommands.filter(
      (existCommand) =>
        !commandList.find(
          (newCommand) =>
            existCommand.name === newCommand.name &&
            existCommand.type === newCommand.type,
        ),
    );

    await Promise.all(deleteCommands.map((command) => command.delete()));
  }

  private splitByCommands(
    existCommandList: Collection<
      string,
      ApplicationCommand<{ guild: GuildResolvable }>
    >,
    commandList: ApplicationCommandData[],
  ): [
    ApplicationCommandData[],
    {
      existCommand: ApplicationCommand<{ guild: GuildResolvable }>;
      newCommand: ApplicationCommandData;
    }[],
  ] {
    return commandList.reduce(
      (result, newCommand) => {
        const alreadyExist = existCommandList.find(
          (existCommand) =>
            newCommand.name === existCommand.name &&
            newCommand.type === existCommand.type,
        );

        alreadyExist
          ? result[1].push({
              existCommand: alreadyExist,
              newCommand,
            })
          : result[0].push(newCommand);

        return result;
      },
      [[], []],
    );
  }

  private async setupCommands(
    commandList: ApplicationCommandData[],
    { forGuild, removeCommandsBefore }: RegisterCommandOptions,
  ): Promise<ApplicationCommand[]> {
    // Fetch guild or global commands
    const options: FetchApplicationCommandOptions & { guildId: Snowflake } =
      forGuild && {
        guildId: forGuild,
      };
    const existCommandList = await this.client.application.commands.fetch(
      options,
    );

    // Remove if needed
    if (removeCommandsBefore) {
      await this.dropMissingCommands(existCommandList, commandList);

      this.logger.log(`All ${forGuild ? 'guild' : 'global'} commands removed!`);
    }

    let registeredCommands: ApplicationCommand[] = [];

    const [createCommands, editCommands] = this.splitByCommands(
      existCommandList,
      commandList,
    );

    // Edit existing commands
    if (editCommands.length !== 0) {
      const editedCommands = await Promise.all(
        editCommands.map(({ existCommand, newCommand }) =>
          existCommand.edit(newCommand),
        ),
      );

      registeredCommands = registeredCommands.concat(editedCommands);
    }

    // Create new commands
    if (createCommands.length !== 0) {
      const createdCommands = await this.client.application.commands.set(
        commandList,
        forGuild,
      );

      registeredCommands = registeredCommands.concat(
        Array.from(createdCommands.values()),
      );
    }

    this.logger.log(
      `All ${forGuild ? 'guild' : 'global'} commands are registered!`,
    );

    return registeredCommands;
  }

  private async setPermissions(
    registeredCommands: ApplicationCommand[],
    rowCommandsData: Map<Type, ApplicationCommandData>,
    slashCommandsPermissions: SlashCommandPermissions[],
  ) {
    await Promise.all(
      slashCommandsPermissions.map(
        async ({ commandClassType, permissions }) => {
          const commandData = rowCommandsData.get(commandClassType);
          if (!commandData) return;

          const command = registeredCommands.find(
            (command) => command.name === commandData.name,
          );

          await command.permissions.set({ permissions });
        },
      ),
    );

    this.logger.log('All command permissions set!');
  }
}
