export interface BotMove {
    botId: number;
    direction: number;
    mode: 'shoot' | 'move';
}

export interface BotPosition {
    botId: number;
    x: number;
    y: number;
}

export interface BarrierPosition {
    x: number;
    y: number;
}
export interface Move {
    playerId: number;
    moveId: number;
    moves: BotMove[];
}

export interface NewGameRequest {
    clientVersion: string;
    barrierPositions: BarrierPosition[];
    player1BotPositions: BotPosition[];
    player2BotPositions: BotPosition[];
}

export interface GameState {
    moveId: number;
    barrierPositions: BarrierPosition[];
    player1BotPositions: BotPosition[];
    player2BotPositions: BotPosition[];
}
