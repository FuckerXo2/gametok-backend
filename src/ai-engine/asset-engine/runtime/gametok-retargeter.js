/**
 * GameTok Runtime Animation Retargeter for Three.js
 * 
 * Injected into generated Three.js games to bind standalone motion tracks
 * (from `animation_catalog`) to any compatible humanoid character rig.
 */

export const GAMETOK_RETARGETER_SNIPPET = `
/**
 * GameTok Standard Humanoid Retargeter
 * Binds standardized skeletal motion tracks to any humanoid character.
 */
class GameTokHumanoidRetargeter {
    constructor(characterRoot) {
        this.root = characterRoot;
        this.boneMap = new Map();
        this._mapBones();
    }

    _mapBones() {
        const STANDARD_PATTERNS = {
            'Hips': /hips|pelvis|root/i,
            'Spine': /spine/i,
            'Chest': /chest|spine1|spine2/i,
            'Neck': /neck/i,
            'Head': /head/i,
            'LeftShoulder': /left.*shoulder|l.*shoulder|l_clavicle/i,
            'LeftArm': /left.*arm|l.*arm|l_upperarm/i,
            'LeftForeArm': /left.*forearm|l.*forearm|l_forearm/i,
            'LeftHand': /left.*hand|l.*hand|l_hand/i,
            'RightShoulder': /right.*shoulder|r.*shoulder|r_clavicle/i,
            'RightArm': /right.*arm|r.*arm|r_upperarm/i,
            'RightForeArm': /right.*forearm|r.*forearm|r_forearm/i,
            'RightHand': /right.*hand|r.*hand|r_hand/i,
            'LeftUpLeg': /left.*upleg|left.*thigh|l.*thigh|l_thigh/i,
            'LeftLeg': /left.*leg|left.*shin|l.*shin|l_calf/i,
            'LeftFoot': /left.*foot|l.*foot|l_foot/i,
            'RightUpLeg': /right.*upleg|right.*thigh|r.*thigh|r_thigh/i,
            'RightLeg': /right.*leg|right.*shin|r.*shin|r_calf/i,
            'RightFoot': /right.*foot|r.*foot|r_foot/i
        };

        this.root.traverse((node) => {
            if (node.isBone || node.type === 'Bone') {
                for (const [stdName, pattern] of Object.entries(STANDARD_PATTERNS)) {
                    if (pattern.test(node.name) && !this.boneMap.has(stdName)) {
                        this.boneMap.set(stdName, node);
                        break;
                    }
                }
            }
        });
    }

    /**
     * Creates a THREE.AnimationClip from a GameTok standalone motion track
     * @param {object} motionTrack Standard motion track data
     * @returns {THREE.AnimationClip}
     */
    createRetargetedClip(motionTrack) {
        const tracks = [];
        const duration = motionTrack.duration || 1.0;

        if (Array.isArray(motionTrack.tracks)) {
            for (const t of motionTrack.tracks) {
                const targetBone = this.boneMap.get(t.bone);
                if (targetBone) {
                    const trackName = targetBone.name + '.' + t.type; // e.g. 'Hips.quaternion'
                    if (t.type === 'quaternion') {
                        tracks.push(new THREE.QuaternionKeyframeTrack(trackName, t.times, t.values));
                    } else if (t.type === 'position') {
                        tracks.push(new THREE.VectorKeyframeTrack(trackName, t.times, t.values));
                    }
                }
            }
        }

        return new THREE.AnimationClip(motionTrack.name || 'retargeted_motion', duration, tracks);
    }
}
`;
