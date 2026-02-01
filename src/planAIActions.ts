import type { Bot } from './Bot';

export function planAiActions(enemies: Array<Bot>, aiBots: Array<Bot>, barriers: Phaser.Physics.Arcade.StaticGroup, maxMoveDistance: number, shootPreviewLength: number) {
    for (const bot of aiBots) {
        // Find the closest enemy
        let target: Bot | null = null;
        let minDist = Number.POSITIVE_INFINITY;
        for (const e of enemies) {
            const d = Phaser.Math.Distance.Between(bot.sprite.x, bot.sprite.y, e.sprite.x, e.sprite.y);
            if (d < minDist) {
                minDist = d;
                target = e;
            }
        }
        if (target === null) {
            continue;
        }
        let direction = new Phaser.Math.Vector2(
            target.sprite.x - bot.sprite.x,
            target.sprite.y - bot.sprite.y
        );
        if (direction.lengthSq() === 0) {
            direction.set(1, 0);
        }
        direction.normalize();

        // Randomly shoot or move if within shootPreviewLength
        if (minDist <= shootPreviewLength * 4) {
            if (Phaser.Math.Between(0, 1) === 0) {
                bot.action = { type: 'shoot', direction, distance: 0 };
                continue;
            }
        }

        // Otherwise, move
        let distance = Phaser.Math.Between(60, maxMoveDistance);
        // Try to avoid barriers
        let finalDirection = direction.clone();
        let foundClear = false;
        if (barriers) {
            // Try a wide range of angles (every 15 degrees)
            for (let angle = 0; angle < 360; angle += 15) {
                const testDir = direction.clone().rotate(Phaser.Math.DegToRad(angle));
                const testTarget = new Phaser.Math.Vector2(bot.sprite.x, bot.sprite.y).add(testDir.clone().scale(distance));
                let collision = false;
                barriers.getChildren().forEach((barrier: Phaser.GameObjects.GameObject) => {
                    const b = barrier as Phaser.Physics.Arcade.Image;
                    const line = new Phaser.Geom.Line(bot.sprite.x, bot.sprite.y, testTarget.x, testTarget.y);
                    const barrierRect = new Phaser.Geom.Rectangle(b.x - b.displayWidth/2, b.y - b.displayHeight/2, b.displayWidth, b.displayHeight);
                    if (Phaser.Geom.Intersects.LineToRectangle(line, barrierRect)) {
                        collision = true;
                    }
                });
                if (!collision) {
                    finalDirection = testDir;
                    foundClear = true;
                    break;
                }
            }
            // If still blocked, pick a random direction and short distance to wiggle away
            if (!foundClear) {
                const randomAngle = Phaser.Math.Between(0, 359);
                finalDirection = new Phaser.Math.Vector2(1, 0).rotate(Phaser.Math.DegToRad(randomAngle));
                // Try a short distance to avoid getting stuck
                distance = Phaser.Math.Between(20, 40);
            }
        }
        bot.action = { type: 'move', direction: finalDirection, distance };
    }
}
