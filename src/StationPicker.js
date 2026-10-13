import * as THREE from 'three';

// Picking a task by pointing at the work itself, rather than from a menu.
//
// The reason it works this way: in a headset a menu panel is a second place to
// look and a second thing to learn, and it breaks the fiction that you are
// standing at a bench. The two practice pieces are already sitting in front of
// you, so pointing the free hand at one and squeezing the trigger is both the
// most obvious gesture and the one that keeps your eyes on the bench.

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _centre = new THREE.Vector3();

function labelSprite(text, sub) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(10, 14, 20, 0.82)';
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = 'rgba(150, 200, 255, 0.9)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 508, 156);
  ctx.fillStyle = '#eaf2ff';
  ctx.font = 'bold 54px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 256, 68);
  ctx.fillStyle = '#9fc0e0';
  ctx.font = '30px sans-serif';
  ctx.fillText(sub, 256, 118);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  );
  sprite.scale.set(0.16, 0.05, 1);
  sprite.renderOrder = 10;
  return sprite;
}

export class StationPicker {
  /**
   * @param {THREE.Object3D} parent  where the markers live, usually the bench group
   * @param {Array<{id:string,title:string,hint:string,group:THREE.Object3D,picks:THREE.Object3D[]}>} stations
   */
  constructor(parent, stations) {
    this.stations = stations;
    this.hovered = null;
    this.markers = new Map();

    for (const station of stations) {
      const marker = new THREE.Group();

      // A box drawn round the piece, not a highlight on the piece itself: the
      // workpiece material is the thing being judged for realism and tinting
      // it would undo that.
      _box.setFromObject(station.group);
      _box.getSize(_size);
      _box.getCenter(_centre);
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(
          _size.x * 1.18 + 0.01, _size.y * 1.3 + 0.01, _size.z * 1.18 + 0.01
        )),
        new THREE.LineBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0 })
      );
      outline.position.copy(_centre).sub(station.group.position);
      marker.add(outline);

      const label = labelSprite(station.title, station.hint);
      label.position.copy(outline.position);
      label.position.y += _size.y * 0.5 + 0.055;
      label.material.opacity = 0;
      marker.add(label);

      marker.position.copy(station.group.position);
      parent.add(marker);
      this.markers.set(station.id, { marker, outline, label, glow: 0 });
    }
  }

  /**
   * @param {number} dt
   * @param {THREE.Raycaster|null} raycaster  already aimed, or null if nothing is pointing
   * @param {string} activeId
   * @param {boolean} blocked  something nearer already claimed the ray
   */
  update(dt, raycaster, activeId, blocked = false) {
    const hit = raycaster && !blocked ? this.pick(raycaster) : null;
    this.hovered = hit;

    for (const station of this.stations) {
      const m = this.markers.get(station.id);
      // The active station keeps a faint outline so it is always clear which
      // piece the torch is scoring against; hovering lifts it to full.
      const want = station === hit ? 1 : (station.id === activeId ? 0.18 : 0);
      m.glow += (want - m.glow) * Math.min(1, dt * 12);
      m.outline.material.opacity = m.glow;
      m.label.material.opacity = station === hit ? Math.min(1, m.glow * 1.4) : 0;
      m.label.visible = m.label.material.opacity > 0.01;
    }
    return hit;
  }

  pick(raycaster) {
    for (const station of this.stations) {
      if (raycaster.intersectObjects(station.picks, true).length) return station;
    }
    return null;
  }

  dispose() {
    for (const { marker, outline, label } of this.markers.values()) {
      outline.geometry.dispose();
      outline.material.dispose();
      label.material.map.dispose();
      label.material.dispose();
      marker.parent?.remove(marker);
    }
    this.markers.clear();
  }
}

/** A thin line out of the free hand, so pointing has something to aim with. */
export function pointerRay(length = 1.2) {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -length),
  ]);
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.45 })
  );
  line.name = 'station-pointer';
  return line;
}
