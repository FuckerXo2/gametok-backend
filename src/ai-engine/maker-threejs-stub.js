// 3D (three.js) stub generator for the threejs-kernel template.
// Produces a native Three.js skeleton so the Phase 2 agent can write raw 3D code.

export function isThreeFoundation(foundation = {}) {
    const dimension = String(foundation?.dimension || '').toUpperCase();
    const lane = String(foundation?.lane || '').toLowerCase();
    return dimension === '3D' || lane.includes('threejs') || lane.includes('voxel_world');
}

export function buildThreeExtraFiles(foundation = {}, qualityIntent = {}) {
    return [];
}

export function buildThreeScaffoldFiles(foundation = {}, qualityIntent = {}) {
    return [
        {
            path: 'src/main.ts',
            content: buildThreeMainTsStubFromFoundation(foundation, qualityIntent)
        }
    ];
}

export function buildThreeMainTsStubFromFoundation(foundation = {}, qualityIntent = {}) {
    return `// @ts-nocheck
import * as THREE from 'three';

// GameTok Native Three.js foundation stub
// Foundation: ${foundation.foundationId || 'dynamic'} (${foundation.lane || 'threejs'})
// Phase 2 owns the full 3D game logic in this file.
// Load any GLTF models directly from public CDNs like raw.githubusercontent.com.

let camera, scene, renderer;

function init() {
    const container = document.getElementById('game-container');
    if (!container) return;

    camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 0.01, 10 );
    camera.position.z = 1;

    scene = new THREE.Scene();

    const geometry = new THREE.BoxGeometry( 0.2, 0.2, 0.2 );
    const material = new THREE.MeshNormalMaterial();

    const mesh = new THREE.Mesh( geometry, material );
    scene.add( mesh );

    renderer = new THREE.WebGLRenderer( { antialias: true } );
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.setAnimationLoop( animation );
    container.appendChild( renderer.domElement );

    window.addEventListener( 'resize', onWindowResize );
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( window.innerWidth, window.innerHeight );
}

function animation( time ) {
    // Game loop logic
    renderer.render( scene, camera );
}

init();

// Expose probe for verification
window.__GAMETOK_TEMPLATE_PROBE__ = {
    snapshot() { return { score: 0, started: true }; },
    step() { return this.snapshot(); },
    reset() { return this.snapshot(); }
};
`;
}
