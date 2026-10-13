import * as THREE from 'three';

// Playback owns its cursor; it never advances the trainee's plan or scoring.
export class MasterDemo {
  constructor(seam, plan, guide) {
    Object.assign(this, { seam, plan, guide });
    this.playing = false;
    this.index = 0;
    this.p = 0;
    this.pause = 0;
  }
  start(torch = null, scene = null) {
    if (!this.guide) return false;
    this.playing = true;
    this.index = 0;
    this.p = -this.plan.strokes[0].leadP(this.seam.length);
    this.pause = 0;
    this.guide.reset();
    if (torch && scene) {
      torch.updateWorldMatrix(true, false);
      this.frozen = {
        torch, parent: torch.parent,
        position: torch.position.clone(), quaternion: torch.quaternion.clone(),
        scale: torch.scale.clone(), world: torch.matrixWorld.clone(),
      };
      scene.attach(torch);
    }
    return true;
  }
  stop() {
    if (this.frozen) {
      const f = this.frozen;
      f.parent.add(f.torch);
      f.torch.position.copy(f.position);
      f.torch.quaternion.copy(f.quaternion);
      f.torch.scale.copy(f.scale);
      this.frozen = null;
    }
    this.playing = false;
    this.guide?.reset();
  }
  update(dt) {
    if (!this.playing) return;
    if (this.frozen) {
      const f = this.frozen;
      f.torch.parent.updateWorldMatrix(true, false);
      const local = f.torch.parent.matrixWorld.clone().invert().multiply(f.world);
      local.decompose(f.torch.position, f.torch.quaternion, f.torch.scale);
      f.torch.visible = true;
    }
    let stroke = this.plan.strokes[this.index];
    if (this.pause > 0) {
      this.pause -= dt;
      if (this.pause <= 0) {
        this.index = (this.index + 1) % this.plan.strokes.length;
        stroke = this.plan.strokes[this.index];
        this.p = -stroke.leadP(this.seam.length);
        this.guide.reset();
      }
    } else {
      const target = stroke.sample(THREE.MathUtils.clamp(this.p, 0, 1));
      this.p += target.speed * dt / (stroke.span * this.seam.length);
      const end = 1 + stroke.trailP(this.seam.length);
      if (this.p >= end) { this.p = end; this.pause = 0.7; }
    }
    const sample = p => ({
      t: stroke.tAt(p),
      lateral: stroke.lateralAt(p, this.seam.length),
      ...stroke.sample(THREE.MathUtils.clamp(p, 0, 1)),
    });
    const current = sample(this.p);
    this.guide.setVisible(true);
    this.guide.update(current.t, current, stroke.dir, current.lateral, fraction =>
      sample(Math.min(1 + stroke.trailP(this.seam.length),
        this.p + fraction * 0.025 / (stroke.span * this.seam.length))), dt);
  }
}
