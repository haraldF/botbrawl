export type ActionType = 'move' | 'shoot' | 'none';

export type BotAction = {
    type: ActionType;
    direction: Phaser.Math.Vector2;
    distance: number;
    target?: Phaser.Math.Vector2;
};

export type Bot = {
    id: number;
    sprite: Phaser.Physics.Arcade.Image;
    playerId: 1 | 2;
    action: BotAction;
    isAlive: boolean;
    selectedMode: Exclude<ActionType, 'none'>;
    plannedMove?: BotAction;
    plannedShoot?: BotAction;
};

