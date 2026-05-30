import type { Bot, BotAction } from '../Bot.js';
import { GameConfig } from '../GameConfig.js';

const TEAM_SIZE = 5;

export interface SpawnedTeams {
    player1: Bot[];
    player2: Bot[];
}

/** Creates the two teams of bots and places them without overlap. */
export class BotFactory {
    private nextBotId = 1;

    constructor(private readonly scene: Phaser.Scene) {}

    spawnTeams(): SpawnedTeams {
        const leftX = GameConfig.BOT_SPAWN_PADDING;
        const rightX = this.scene.scale.width - GameConfig.BOT_SPAWN_PADDING;

        const player1 = this.spawnTeam(leftX, 1, GameConfig.BOT_PLAYER_TEXTURE, []);
        const player2 = this.spawnTeam(rightX, 2, GameConfig.BOT_AI_TEXTURE, player1);
        return { player1, player2 };
    }

    private spawnTeam(x: number, playerId: 1 | 2, texture: string, others: Bot[]): Bot[] {
        const team: Bot[] = [];
        for (let i = 0; i < TEAM_SIZE; i++) {
            const y = this.findNonOverlappingY(x, [...team, ...others]);
            team.push(this.createBot(x, y, playerId, texture));
        }
        return team;
    }

    private findNonOverlappingY(x: number, others: Bot[]): number {
        const padding = GameConfig.BOT_SPAWN_PADDING;
        const fieldHeight = this.scene.scale.height;
        const minDistance = GameConfig.BOT_MIN_DISTANCE;

        for (let attempt = 0; attempt < 100; attempt++) {
            const y = Phaser.Math.Between(padding, fieldHeight - padding);
            const tooClose = others.some(other =>
                Phaser.Math.Distance.Between(x, y, other.sprite.x, other.sprite.y) < minDistance
            );
            if (!tooClose) return y;
        }
        return padding + others.length * ((fieldHeight - 2 * padding) / TEAM_SIZE);
    }

    private createBot(x: number, y: number, playerId: 1 | 2, texture: string): Bot {
        const sprite = this.scene.physics.add.image(x, y, texture);
        sprite.setCollideWorldBounds(true);
        sprite.setDamping(true);
        sprite.setDrag(0.9, 0.9);
        sprite.setMaxVelocity(GameConfig.BOT_MAX_VELOCITY, GameConfig.BOT_MAX_VELOCITY);
        sprite.body.onWorldBounds = true;

        const initialAction: BotAction = {
            type: 'none',
            direction: new Phaser.Math.Vector2(1, 0),
            distance: 0,
        };
        return {
            id: this.nextBotId++,
            sprite,
            playerId,
            action: initialAction,
            isAlive: true,
            selectedMode: 'move',
        };
    }
}
