import * as THREE from 'three';

// Copy each eye's viewport before filtering; HUD is drawn afterward in colour.
export class HelmetView {
  constructor(scene, renderer, camera, controls, workpiece, eyeOffset) {
    Object.assign(this, { renderer, camera, controls, workpiece, eyeOffset });
    this.enabled = false;
    this.xDown = false;
    this.filter = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { uArc: { value: 0 }, uScene: { value: null }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
      fragmentShader: `precision mediump float; varying vec2 vUv; uniform float uArc; uniform float uTime; uniform sampler2D uScene;
        void main(){
          vec2 p=abs(vUv-0.5);
          float aperture=1.0-smoothstep(0.0,0.025,max(p.x-0.43,p.y-0.34));
          float vignette=1.0-0.65*smoothstep(0.1,0.48,length(vUv-0.5));
          vec3 sceneColor=texture2D(uScene,vUv).rgb;
          float luminance=dot(sceneColor,vec3(0.2126,0.7152,0.0722));
          float intensity=pow(luminance,1.35)*mix(0.22,0.65,uArc);
          // A stationary view must not shimmer with time-varying screen noise.
          intensity=max(0.0,intensity);
          vec3 phosphor=vec3(0.10,1.0,0.18)*intensity;
          gl_FragColor=vec4(phosphor*aperture*vignette,1.0);
        }`,
      transparent: true, blending: THREE.NoBlending,
      depthTest: false, depthWrite: false, toneMapped: false,
    }));
    this.filter.frustumCulled = false;
    this.filter.renderOrder = 100000;
    this.filter.visible = false;
    scene.add(this.filter);
    this.viewport = new THREE.Vector4();
    this.eyeCaptures = new Map();
    this.copyOrigin = new THREE.Vector2();
    this.filter.onBeforeRender = renderer => this.captureEye(renderer);
    window.addEventListener('keydown', e => {
      if (e.code === 'KeyX' && !e.repeat && this.keyboardEnabled !== false) this.toggle();
    });
    renderer.xr.addEventListener('sessionstart', () => this.restoreCamera());
    renderer.xr.addEventListener('sessionend', () => {
      this.xDown = false;
      if (this.enabled) this.enterCamera();
    });
  }
  captureEye(renderer) {
    renderer.getCurrentViewport(this.viewport);
    const width = Math.max(1, Math.round(this.viewport.z));
    const height = Math.max(1, Math.round(this.viewport.w));
    const key = `${this.viewport.x}:${this.viewport.y}`;
    let capture = this.eyeCaptures.get(key);
    if (!capture || capture.image.width !== width || capture.image.height !== height) {
      capture?.dispose();
      capture = new THREE.FramebufferTexture(width, height);
      capture.minFilter = capture.magFilter = THREE.LinearFilter;
      this.eyeCaptures.set(key, capture);
    }
    this.capture = capture;
    this.filter.material.uniforms.uScene.value = capture;
    this.filter.material.uniformsNeedUpdate = true;
    this.copyOrigin.set(this.viewport.x, this.viewport.y);
    renderer.copyFramebufferToTexture(this.copyOrigin, capture);
  }
  enterCamera() {
    if (this.saved) return;
    this.saved = { position: this.camera.position.clone(), target: this.controls.target.clone() };
    this.workpiece.updateWorldMatrix(true, false);
    this.camera.position.copy(this.workpiece.localToWorld(this.eyeOffset.clone()));
    this.workpiece.getWorldPosition(this.controls.target);
    this.controls.update();
  }
  restoreCamera() {
    if (!this.saved) return;
    this.camera.position.copy(this.saved.position);
    this.controls.target.copy(this.saved.target);
    this.controls.update();
    this.saved = null;
  }
  toggle() {
    this.enabled = !this.enabled;
    this.filter.visible = this.enabled;
    if (!this.renderer.xr.isPresenting) {
      if (this.enabled) this.enterCamera(); else this.restoreCamera();
    }
  }
  update(arcOn) {
    const inputs = this.renderer.xr.getSession()?.inputSources ?? [];
    const left = Array.from(inputs).find(s => !s.hand && s.handedness === 'left');
    // xr-standard: primary face button is index 4 (X on the left Quest hand).
    const pressed = left?.gamepad?.mapping === 'xr-standard' && !!left.gamepad.buttons[4]?.pressed;
    if (pressed && !this.xDown) this.toggle();
    this.xDown = pressed;
    this.filter.material.uniforms.uArc.value = arcOn ? 1 : 0;
    this.filter.material.uniforms.uTime.value = performance.now() * 0.001;
  }
}
