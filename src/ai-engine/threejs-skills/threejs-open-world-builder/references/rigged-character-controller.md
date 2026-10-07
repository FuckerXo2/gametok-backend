# 100-Bone Rigged Humanoid Controller & Mobile Touch Rig

## Loading User-Attached Rigged GLTF

```javascript
class HeroController {
    constructor(scene, camera, glbUrl) {
        this.scene = scene;
        this.camera = camera;
        this.glbUrl = glbUrl;
        this.mesh = null;
        this.mixer = null;
        this.actions = {};
        this.currentActionName = 'idle';

        this.position = new THREE.Vector3(0, 0, 0);
        this.velocity = new THREE.Vector3();
        this.heading = 0;
        this.targetHeading = 0;
        this.isGrounded = true;
        this.speed = 0;
        this.walkSpeed = 5.5;
        this.sprintSpeed = 10.5;

        this.initModel();
    }

    initModel() {
        const loader = new THREE.GLTFLoader();
        loader.load(
            this.glbUrl,
            (gltf) => {
                this.mesh = gltf.scene;
                this.mesh.scale.set(1.0, 1.0, 1.0);
                this.mesh.traverse((node) => {
                    if (node.isMesh) {
                        node.castShadow = true;
                        node.receiveShadow = true;
                    }
                });
                this.scene.add(this.mesh);
                this.mixer = new THREE.AnimationMixer(this.mesh);

                if (gltf.animations && gltf.animations.length > 0) {
                    gltf.animations.forEach((clip) => {
                        const name = clip.name.toLowerCase();
                        this.actions[name] = this.mixer.clipAction(clip);
                    });
                    this.playAction('idle');
                } else {
                    // Fallback procedural animation generator if clips are separate
                    this.setupProceduralLocomotion(this.mesh);
                }
            },
            undefined,
            (err) => {
                console.warn('Failed to load rigged GLTF, building stylized proxy', err);
                this.mesh = this.createStylizedProxy();
                this.scene.add(this.mesh);
            }
        );
    }

    playAction(name, crossFadeDuration = 0.25) {
        if (!this.actions[name] || this.currentActionName === name) return;
        const prev = this.actions[this.currentActionName];
        const next = this.actions[name];
        next.reset().fadeIn(crossFadeDuration).play();
        if (prev) prev.fadeOut(crossFadeDuration);
        this.currentActionName = name;
    }

    update(delta, inputVector, isSprint = false) {
        if (!this.mesh) return;

        if (this.mixer) this.mixer.update(delta);

        const inputLength = Math.hypot(inputVector.x, inputVector.y);
        if (inputLength > 0.1) {
            const maxSpeed = isSprint ? this.sprintSpeed : this.walkSpeed;
            this.speed = THREE.MathUtils.lerp(this.speed, maxSpeed * inputLength, 0.15);

            // Compute camera-relative movement direction
            this.targetHeading = Math.atan2(inputVector.x, inputVector.y);
            this.heading = THREE.MathUtils.lerp(this.heading, this.targetHeading, 0.2);
            this.mesh.rotation.y = this.heading;

            // Move forward
            const moveDir = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
            this.mesh.position.addScaledVector(moveDir, this.speed * delta);

            // Trigger animation state
            if (isSprint && inputLength > 0.7) {
                this.playAction('run');
            } else {
                this.playAction('walk');
            }
        } else {
            this.speed = THREE.MathUtils.lerp(this.speed, 0, 0.2);
            this.playAction('idle');
        }

        this.position.copy(this.mesh.position);
    }
}
```

## Mobile Touch Joystick Implementation
Provide a touch joystick that requires zero external dependencies:
```javascript
class VirtualTouchJoystick {
    constructor() {
        this.input = { x: 0, y: 0 };
        this.active = false;
        this.touchId = null;
        this.origin = { x: 0, y: 0 };
        this.current = { x: 0, y: 0 };
        this.maxRadius = 55; // pixels

        this.createDOM();
        this.bindEvents();
    }

    createDOM() {
        this.container = document.createElement('div');
        this.container.style.cssText = `
            position: fixed; bottom: 25px; left: 25px; width: 130px; height: 130px;
            border-radius: 50%; background: rgba(255, 255, 255, 0.08);
            border: 2px solid rgba(255, 255, 255, 0.18); backdrop-filter: blur(8px);
            z-index: 999; touch-action: none; pointer-events: auto; display: flex;
            align-items: center; justify-content: center;
        `;
        this.knob = document.createElement('div');
        this.knob.style.cssText = `
            width: 52px; height: 52px; border-radius: 50%;
            background: radial-gradient(circle, #ffcc00, #ff8800);
            box-shadow: 0 4px 15px rgba(255, 170, 0, 0.4);
            transform: translate(0px, 0px); transition: transform 0.05s ease-out;
        `;
        this.container.appendChild(this.knob);
        document.body.appendChild(this.container);
    }

    bindEvents() {
        this.container.addEventListener('touchstart', (e) => {
            const touch = e.changedTouches[0];
            this.active = true;
            this.touchId = touch.identifier;
            const rect = this.container.getBoundingClientRect();
            this.origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            this.handleMove(touch.clientX, touch.clientY);
            window.GameTOK?.haptic('light');
        }, { passive: false });

        window.addEventListener('touchmove', (e) => {
            if (!this.active) return;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === this.touchId) {
                    this.handleMove(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
                    break;
                }
            }
        }, { passive: false });

        const endTouch = (e) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === this.touchId) {
                    this.active = false;
                    this.input = { x: 0, y: 0 };
                    this.knob.style.transform = `translate(0px, 0px)`;
                    break;
                }
            }
        };
        window.addEventListener('touchend', endTouch);
        window.addEventListener('touchcancel', endTouch);
    }

    handleMove(clientX, clientY) {
        const dx = clientX - this.origin.x;
        const dy = clientY - this.origin.y;
        const dist = Math.hypot(dx, dy);
        const clampedDist = Math.min(dist, this.maxRadius);
        const angle = Math.atan2(dy, dx);

        const kx = Math.cos(angle) * clampedDist;
        const ky = Math.sin(angle) * clampedDist;
        this.knob.style.transform = `translate(${kx}px, ${ky}px)`;

        // Normalized input vector: x = right, y = forward (up is -dy in screen coords)
        this.input = {
            x: kx / this.maxRadius,
            y: -ky / this.maxRadius
        };
    }
}
```
