import { Injectable } from '@nestjs/common';
import { ApplicationCommandOptionChoiceData } from 'discord.js';
import {
  ApplicationCommandOptionTypes,
  ChannelTypes,
} from 'discord.js/typings/enums';

import { ParamOptions } from '../../decorators/option/param/param-options';
import { ExcludeEnum } from '../../definitions/types/exclude-enum.type';
import { ParamType } from '../../definitions/types/param.type';
import { ReflectMetadataProvider } from '../../providers/reflect-metadata.provider';
import { OptionMetadata } from './option-metadata';

@Injectable()
export class OptionExplorer {
  constructor(private readonly metadataProvider: ReflectMetadataProvider) {}

  explore(dtoInstance: any): OptionMetadata {
    const optionMetadata: OptionMetadata = {};

    Object.keys(dtoInstance).map((propertyKey: string) => {
      const paramDecoratorMetadata =
        this.metadataProvider.getParamDecoratorMetadata(
          dtoInstance,
          propertyKey,
        );
      const channelTypes = this.getChannelOptions(dtoInstance, propertyKey);
      const applicationOptionType = channelTypes
        ? ApplicationCommandOptionTypes.CHANNEL
        : this.getApplicationOptionTypeByArg(
            dtoInstance,
            propertyKey,
            paramDecoratorMetadata,
          );
      optionMetadata[propertyKey] = {
        param: {
          name: paramDecoratorMetadata.name ?? propertyKey,
          description: paramDecoratorMetadata.description,
          type: applicationOptionType,
          maxValue: paramDecoratorMetadata.maxValue,
          minValue: paramDecoratorMetadata.minValue,
          autocomplete: paramDecoratorMetadata.autocomplete,
          required: paramDecoratorMetadata.required,
        },
        choice: this.getChoiceOptions(dtoInstance, propertyKey),
        channelTypes,
      };
    });

    return optionMetadata;
  }

  private getChoiceOptions(
    dtoInstance: any,
    propertyKey: string,
  ): ApplicationCommandOptionChoiceData[] {
    const choiceData = this.metadataProvider.getChoiceDecoratorMetadata(
      dtoInstance,
      propertyKey,
    );
    if (!choiceData) return;

    const isMap = choiceData instanceof Map;

    const entries = isMap
      ? Array.from(choiceData)
      : Object.entries(choiceData).filter(
          ([key]) => !(key in Object.keys(choiceData)),
        );

    return entries.map(([name, value]) => ({ name, value }));
  }

  private getChannelOptions(
    dtoInstance: any,
    propertyKey: string,
  ): ExcludeEnum<typeof ChannelTypes, 'UNKNOWN'>[] {
    const channelTypes = this.metadataProvider.getChannelDecoratorMetadata(
      dtoInstance,
      propertyKey,
    );
    if (!channelTypes) return;

    return channelTypes;
  }

  private getApplicationOptionTypeByArg(
    dtoInstance: any,
    propertyKey: string,
    argDecoratorOptions: ParamOptions,
  ): ApplicationCommandOptionTypes {
    switch (argDecoratorOptions.type) {
      case ParamType.STRING:
        return ApplicationCommandOptionTypes.STRING;
      case ParamType.BOOLEAN:
        return ApplicationCommandOptionTypes.BOOLEAN;
      case ParamType.INTEGER:
        return ApplicationCommandOptionTypes.INTEGER;
      case ParamType.NUMBER:
        return ApplicationCommandOptionTypes.NUMBER;
      case ParamType.ROLE:
        return ApplicationCommandOptionTypes.ROLE;
      case ParamType.MENTIONABLE:
        return ApplicationCommandOptionTypes.MENTIONABLE;
      case ParamType.USER:
        return ApplicationCommandOptionTypes.USER;
      default: {
        const metatype = this.metadataProvider.getPropertyTypeMetadata(
          dtoInstance,
          propertyKey,
        );
        if (metatype.name === 'String')
          return ApplicationCommandOptionTypes.STRING;

        if (metatype.name === 'Boolean')
          return ApplicationCommandOptionTypes.BOOLEAN;

        throw new Error(
          `Could not determine field type "${propertyKey}" in class "${dtoInstance.constructor.name}"`,
        );
      }
    }
  }
}
