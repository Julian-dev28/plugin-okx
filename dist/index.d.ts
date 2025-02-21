import { Character, Plugin } from '@elizaos/core';

declare const OKXPlugin: (character: Character) => Promise<Plugin>;

export { OKXPlugin, OKXPlugin as default };
