import { CommandExecutionContext } from '../../definitions/interfaces/command-execution-context';
import { DiscordCommand } from '../../definitions/interfaces/discord-command';
import { TransformedCommandExecutionContext } from '../../definitions/interfaces/transformed-command-execution-context';
import { DiscordCommandProvider } from '../../providers/discord-command.provider';
import { ReflectMetadataProvider } from '../../providers/reflect-metadata.provider';
import { BuildApplicationCommandService } from '../../services/build-application-command.service';
import { CommandTreeService } from '../../services/command-tree.service';
import { DiscordClientService } from '../../services/discord-client.service';
import { CollectorResolver } from '../collector/use-collectors/collector.resolver';
import { FilterResolver } from '../filter/filter.resolver';
import { GuardResolver } from '../guard/guard.resolver';
import { ClassResolveOptions } from '../interfaces/class-resolve-options';
import { ClassResolver } from '../interfaces/class-resolver';
import { MiddlewareResolver } from '../middleware/middleware.resolver';
import { PipeResolver } from '../pipe/pipe.resolver';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  ClientEvents,
  InteractionCollector,
  MessageCollector,
} from 'discord.js';

@Injectable()
export class CommandResolver implements ClassResolver {
  constructor(
    private readonly discordClientService: DiscordClientService,
    private readonly metadataProvider: ReflectMetadataProvider,
    private readonly middlewareResolver: MiddlewareResolver,
    private readonly discordCommandProvider: DiscordCommandProvider,
    private readonly guardResolver: GuardResolver,
    private readonly moduleRef: ModuleRef,
    private readonly pipeResolver: PipeResolver,
    private readonly buildApplicationCommandService: BuildApplicationCommandService,
    private readonly commandTreeService: CommandTreeService,
    private readonly filterResolver: FilterResolver,
    private readonly collectorResolver: CollectorResolver,
  ) {}

  async resolve({
    instance,
  }: ClassResolveOptions<DiscordCommand>): Promise<void> {
    const metadata =
      this.metadataProvider.getCommandDecoratorMetadata(instance);
    if (!metadata) return;

    const { name } = metadata;
    const event = 'interactionCreate';
    const methodName = 'handler';
    const applicationCommandData =
      await this.buildApplicationCommandService.resolveCommandOptions(
        instance,
        methodName,
        metadata,
      );

    this.discordCommandProvider.addCommand(applicationCommandData);

    this.discordClientService
      .getClient()
      .on(event, async (...eventArgs: ClientEvents['interactionCreate']) => {
        const [interaction] = eventArgs;
        if (!interaction.isCommand() || interaction.commandName !== name)
          return;

        const subcommand = interaction.options.getSubcommand(false);
        const subcommandGroup = interaction.options.getSubcommandGroup(false);

        const commandNode = this.commandTreeService.getNode([
          interaction.commandName,
          subcommandGroup,
          subcommand,
        ]);

        const { dtoInstance, instance: commandInstance } = commandNode;

        try {
          //#region apply middleware, guard, pipe
          await this.middlewareResolver.applyMiddleware(event, eventArgs);
          const isAllowFromGuards = await this.guardResolver.applyGuard({
            instance,
            methodName,
            event,
            eventArgs,
          });
          if (!isAllowFromGuards) return;

          const pipeResult = await this.pipeResolver.applyPipe({
            instance: commandInstance,
            methodName,
            event,
            metatype: dtoInstance?.constructor,
            eventArgs,
            initValue: interaction,
            commandNode,
          });
          //#endregion

          const collectors = this.collectorResolver.applyCollector({
            instance,
            methodName,
            event,
            eventArgs,
          }) as (MessageCollector | InteractionCollector<any>)[];

          const transformedExecutionContext: TransformedCommandExecutionContext =
            {
              interaction,
              collectors,
            };
          const executionContext: CommandExecutionContext = {
            collectors,
          };

          const handlerArgs = dtoInstance
            ? [pipeResult, transformedExecutionContext]
            : [interaction, executionContext];
          const replyResult = await commandInstance[methodName](...handlerArgs);

          if (replyResult) await interaction.reply(replyResult);
        } catch (exception) {
          const isTrowException = await this.filterResolver.applyFilter({
            instance: commandInstance,
            methodName,
            event,
            metatype: dtoInstance?.constructor,
            eventArgs,
            exception,
            commandNode,
          });

          if (isTrowException) throw exception;
        }
      });
  }
}
