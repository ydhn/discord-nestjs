import { Constants } from 'discord.js';

import { BaseEvents, EventType } from '../../definitions/types/event.type';

export function IsBaseEvent(event: EventType): event is BaseEvents {
  return Object.values(Constants.Events)
    .concat(['modalSubmit']) // TODO: Remove in next minor release
    .includes(event);
}
