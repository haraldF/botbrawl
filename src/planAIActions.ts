import type { Bot } from './Bot';
import { GameConfig } from './GameConfig.js';

type Barriers = Phaser.Physics.Arcade.StaticGroup;

/** Actual reach of a regular shot — mirrors BulletSystem.spawnShot. */
function computeShotRange(): number {
    return Math.min(GameConfig.GAME_WIDTH, GameConfig.GAME_HEIGHT) / 2;
}

/** Actual reach of a sniper shot — mirrors BulletSystem.spawnSniperShot. */
function computeSniperRange(): number {
    return computeShotRange() * GameConfig.SNIPER_RANGE_MULTIPLIER;
}

export function planAiActions(
    enemies: Array<Bot>,
    aiBots: Array<Bot>,
    barriers: Phaser.Physics.Arcade.StaticGroup,
    maxMoveDistance: number,
    shootPreviewLength: number,
    sniperPreviewLength: number = GameConfig.SNIPER_PREVIEW_LENGTH
) {
    const liveEnemies = enemies.filter(e => e.isAlive && !e.isDisabled);
    const eligibleAi = aiBots.filter(b => b.isAlive && !b.isDisabled);
    const shootRange = computeShotRange();
    const sniperRange = computeSniperRange();

    // Disabled enemies just sniped and are sitting ducks for one turn — prioritize a snipe on them,
    // but only let ONE bot per turn take the sniper shot (it disables the shooter for the next turn).
    const sniperShooter = pickSniperOpportunity(enemies, eligibleAi, aiBots, barriers, sniperRange);
    const planned = new Set<Bot>();
    if (sniperShooter) {
        sniperShooter.bot.action = {
            type: 'sniper',
            direction: sniperShooter.direction,
            distance: 0,
        };
        planned.add(sniperShooter.bot);
    }

    for (const bot of eligibleAi) {
        if (planned.has(bot)) continue;

        // Find the closest live enemy
        let target: Bot | null = null;
        let minDist = Number.POSITIVE_INFINITY;
        for (const e of liveEnemies) {
            const d = Phaser.Math.Distance.Between(bot.sprite.x, bot.sprite.y, e.sprite.x, e.sprite.y);
            if (d < minDist) {
                minDist = d;
                target = e;
            }
        }
        if (target === null) {
            continue;
        }

        const direction = new Phaser.Math.Vector2(
            target.sprite.x - bot.sprite.x,
            target.sprite.y - bot.sprite.y
        );
        if (direction.lengthSq() === 0) {
            direction.set(1, 0);
        }
        direction.normalize();

        const allies = aiBots.filter(a => a !== bot && a.isAlive);
        const exposed = hasClearLineOfSight(bot, target, barriers)
            && !wouldHitAlly(bot, direction, minDist, allies);

        // Within close range: occasionally shoot, otherwise move.
        // Sniper is reserved for the dedicated sniper opportunity picked above.
        if (exposed && minDist <= shootRange) {
            if (Phaser.Math.Between(0, 1) === 0) {
                bot.action = { type: 'shoot', direction, distance: 0 };
                continue;
            }
        }

        // Otherwise, move — try to seek cover from live enemies behind barriers.
        const moveAction = planCoverSeekingMove(bot, target, liveEnemies, barriers, maxMoveDistance);
        bot.action = moveAction;
    }
}

/**
 * Find the best (shooter, disabled-enemy) sniper pair across all AI bots, or null if none viable.
 * Prefers the shortest viable shot to maximize hit chance.
 */
function pickSniperOpportunity(
    enemies: Array<Bot>,
    eligibleAi: Array<Bot>,
    allAi: Array<Bot>,
    barriers: Barriers,
    sniperRange: number
): { bot: Bot; direction: Phaser.Math.Vector2 } | null {
    const disabledEnemies = enemies.filter(e => e.isAlive && e.isDisabled);
    if (disabledEnemies.length === 0 || eligibleAi.length === 0) return null;

    let best: { bot: Bot; direction: Phaser.Math.Vector2; dist: number } | null = null;
    for (const shooter of eligibleAi) {
        const allies = allAi.filter(a => a !== shooter && a.isAlive);
        for (const enemy of disabledEnemies) {
            const dx = enemy.sprite.x - shooter.sprite.x;
            const dy = enemy.sprite.y - shooter.sprite.y;
            const dist = Math.hypot(dx, dy);
            if (dist === 0 || dist > sniperRange) continue;
            if (!hasClearLineOfSight(shooter, enemy, barriers)) continue;

            const direction = new Phaser.Math.Vector2(dx / dist, dy / dist);
            if (wouldHitAlly(shooter, direction, dist, allies)) continue;

            if (!best || dist < best.dist) {
                best = { bot: shooter, direction, dist };
            }
        }
    }
    return best ? { bot: best.bot, direction: best.direction } : null;
}

/**
 * Pick a movement destination that ideally breaks line-of-sight from enemies.
 * Samples candidate angles/distances and scores them by cover, reachability,
 * and a soft preference for staying close enough to the target to engage later.
 */
function planCoverSeekingMove(
    bot: Bot,
    target: Bot,
    enemies: Array<Bot>,
    barriers: Barriers,
    maxMoveDistance: number
): { type: 'move'; direction: Phaser.Math.Vector2; distance: number } {
    const origin = new Phaser.Math.Vector2(bot.sprite.x, bot.sprite.y);
    const margin = GameConfig.BOT_SPAWN_PADDING;
    const minX = margin;
    const maxX = GameConfig.GAME_WIDTH - margin;
    const minY = margin;
    const maxY = GameConfig.GAME_HEIGHT - margin;

    const angleStep = GameConfig.AI_AVOIDANCE_ANGLE_STEP;
    const distances = [maxMoveDistance, maxMoveDistance * 0.66, maxMoveDistance * 0.33];

    let bestScore = -Infinity;
    let bestDir: Phaser.Math.Vector2 | null = null;
    let bestDist = 0;

    for (let angle = 0; angle < 360; angle += angleStep) {
        const dir = new Phaser.Math.Vector2(1, 0).rotate(Phaser.Math.DegToRad(angle));
        for (const dist of distances) {
            const dest = origin.clone().add(dir.clone().scale(dist));
            if (dest.x < minX || dest.x > maxX || dest.y < minY || dest.y > maxY) continue;
            if (lineHitsBarriers(origin.x, origin.y, dest.x, dest.y, barriers)) continue;

            // Count enemies that would lose line-of-sight on us from this destination.
            let coveredCount = 0;
            for (const enemy of enemies) {
                if (lineHitsBarriers(enemy.sprite.x, enemy.sprite.y, dest.x, dest.y, barriers)) {
                    coveredCount++;
                }
            }
            const coverFraction = enemies.length > 0 ? coveredCount / enemies.length : 0;

            // Distance to target — prefer staying within ~1.5x maxMoveDistance so we can engage soon.
            const distToTarget = Phaser.Math.Distance.Between(dest.x, dest.y, target.sprite.x, target.sprite.y);
            const idealRange = maxMoveDistance * 1.5;
            const rangePenalty = Math.abs(distToTarget - idealRange) / idealRange;

            // Score: cover is dominant; tie-break toward ideal engagement distance.
            const score = coverFraction * 10 - rangePenalty + Phaser.Math.FloatBetween(0, 0.05);
            if (score > bestScore) {
                bestScore = score;
                bestDir = dir;
                bestDist = dist;
            }
        }
    }

    if (bestDir) {
        return { type: 'move', direction: bestDir.clone(), distance: bestDist };
    }

    // Nothing reachable — wiggle randomly to get unstuck.
    const randomAngle = Phaser.Math.Between(0, 359);
    return {
        type: 'move',
        direction: new Phaser.Math.Vector2(1, 0).rotate(Phaser.Math.DegToRad(randomAngle)),
        distance: Phaser.Math.Between(GameConfig.AI_WIGGLE_MIN_DISTANCE, GameConfig.AI_WIGGLE_MAX_DISTANCE),
    };
}

/** True if the straight line from shooter to target is not blocked by any barrier. */
function hasClearLineOfSight(shooter: Bot, target: Bot, barriers: Barriers): boolean {
    return !lineHitsBarriers(
        shooter.sprite.x,
        shooter.sprite.y,
        target.sprite.x,
        target.sprite.y,
        barriers
    );
}

function lineHitsBarriers(x1: number, y1: number, x2: number, y2: number, barriers: Barriers): boolean {
    const line = new Phaser.Geom.Line(x1, y1, x2, y2);
    let hit = false;
    barriers.getChildren().forEach((barrier: Phaser.GameObjects.GameObject) => {
        if (hit) return;
        const b = barrier as Phaser.Physics.Arcade.Image;
        const rect = new Phaser.Geom.Rectangle(
            b.x - b.displayWidth / 2,
            b.y - b.displayHeight / 2,
            b.displayWidth,
            b.displayHeight
        );
        if (Phaser.Geom.Intersects.LineToRectangle(line, rect)) {
            hit = true;
        }
    });
    return hit;
}

/**
 * True if a shot from `shooter` along `direction` (up to `maxDistance` away)
 * would pass close enough to an ally to be considered friendly fire.
 */
function wouldHitAlly(
    shooter: Bot,
    direction: Phaser.Math.Vector2,
    maxDistance: number,
    allies: Array<Bot>
): boolean {
    if (allies.length === 0) return false;
    const sx = shooter.sprite.x;
    const sy = shooter.sprite.y;
    for (const ally of allies) {
        const ax = ally.sprite.x - sx;
        const ay = ally.sprite.y - sy;
        // Project ally position onto the shot direction
        const projection = ax * direction.x + ay * direction.y;
        if (projection <= 0 || projection > maxDistance) continue;
        // Perpendicular distance from ally to the shot line
        const perpX = ax - direction.x * projection;
        const perpY = ay - direction.y * projection;
        const perpDist = Math.hypot(perpX, perpY);
        const safeRadius = Math.max(ally.sprite.displayWidth, ally.sprite.displayHeight) / 2
            + GameConfig.SHOOT_LINE_TOLERANCE;
        if (perpDist <= safeRadius) {
            return true;
        }
    }
    return false;
}
