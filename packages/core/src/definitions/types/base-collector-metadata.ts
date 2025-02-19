import { CollectorMetadata } from '../../explorers/collector/collector-metadata';

export type BaseCollectorMetadata = Omit<
  CollectorMetadata,
  'metadata' | 'type' | 'classInstance'
>;
