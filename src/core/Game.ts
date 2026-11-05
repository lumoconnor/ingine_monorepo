import { EventBus } from './EventBus';
import { WorldState } from './WorldState';
import type { System } from './System';
import { FIXED_DT, MAX_STEPS_PER_FRAME, type FrameTime } from './Time';
import { Renderer } from '@/render/Renderer';
import { InputManager } from '@/input/InputManager';
import { PhysicsWorld } from '@/physics/PhysicsWorld';
import { World } from '@/entities/World';
import type { Level } from '@/world/Level';

/**
 * The root object. Owns the core systems and runs the main loop:
 *
 *   every frame:
 *     accumulate real time
 *     while enough time for a fixed step (1/60s):
 *       systems.preFixedUpdate -> entities.fixedUpdate -> systems.postFixedUpdate (physics step)
 *       -> entities.lateFixedUpdate (character movement against the stepped world)
 *     alpha = leftover / FIXED_DT
 *     entities.update(alpha)    -> systems.update -> render
 *
 * Gameplay is deterministic at a fixed rate; rendering interpolates with alpha.
 */
export class Game {
  readonly events = new EventBus();
  /** Flags, variables and items shared by dialogue, quests and triggers. */
  readonly state = new WorldState(this.events);
  readonly renderer: Renderer;
  readonly input: InputManager;
  readonly physics: PhysicsWorld;
  readonly world: World;

  private systems: System[] = [];
  private level: Level | null = null;
  private running = false;
  private lastTime = 0;
  private accumulator = 0;
  private elapsed = 0;
  private rafId = 0;

  /** Simulation speed multiplier (slow-mo debugging). */
  timeScale = 1;
  /** Freezes the simulation (menus). Rendering and UI systems keep running. */
  paused = false;

  constructor(container: HTMLElement) {
    this.renderer = new Renderer(container);
    this.input = new InputManager();
    this.physics = new PhysicsWorld();
    this.world = new World(this);
    // Order matters: input is read first, physics steps after gameplay.
    this.systems.push(this.input, this.physics, this.renderer);
  }

  /** Register an additional system (audio, UI, AI...). Call before start(). */
  addSystem<T extends System>(system: T): T {
    this.systems.push(system);
    return system;
  }

  getSystem<T extends System>(name: string): T | undefined {
    return this.systems.find((s) => s.name === name) as T | undefined;
  }

  async init(): Promise<void> {
    for (const s of this.systems) await s.init?.(this);
  }

  async loadLevel(level: Level): Promise<void> {
    if (this.level) {
      this.level.unload?.(this);
      this.world.clear();
    }
    this.level = level;
    await level.load(this);
    this.events.emit('level:loaded', { name: level.name });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);

    // Clamp large gaps (tab switch, breakpoint) so we don't fast-forward.
    const delta = Math.min((now - this.lastTime) / 1000, 0.25) * this.timeScale;
    this.lastTime = now;
    this.accumulator += delta;
    this.elapsed += delta;

    if (this.paused) this.accumulator = 0;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.fixedStep(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    const time: FrameTime = { delta, elapsed: this.elapsed, alpha: this.accumulator / FIXED_DT };
    if (!this.paused) this.world.update(time);
    for (const s of this.systems) s.update?.(time);
    this.renderer.render();
  };

  private fixedStep(dt: number): void {
    for (const s of this.systems) s.preFixedUpdate?.(dt);
    this.world.fixedUpdate(dt);
    for (const s of this.systems) s.postFixedUpdate?.(dt);
    this.world.lateFixedUpdate(dt);
  }

  dispose(): void {
    this.stop();
    this.world.clear();
    for (const s of [...this.systems].reverse()) s.dispose?.();
  }
}
