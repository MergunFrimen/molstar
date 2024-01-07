/**
 * Copyright (c) 2020-2023 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

export const cylinders_vert = `
precision highp float;
precision highp int;

#include common
#include read_from_texture
#include common_vert_params
#include color_vert_params
#include size_vert_params
#include common_clip

uniform mat4 uModelView;

attribute mat4 aTransform;
attribute float aInstance;
attribute float aGroup;

attribute vec3 aMapping;
attribute vec3 aStart;
attribute vec3 aEnd;
attribute float aScale;
attribute float aCap;
attribute float aColorMode;

varying mat4 vTransform;
varying vec3 vStart;
varying vec3 vEnd;
varying float vSize;
varying float vCap;
varying float vColorMode;

uniform float uIsOrtho;
uniform vec3 uCameraDir;

void main() {
    #include assign_group
    #include assign_color_varying
    #include assign_marker_varying
    #include assign_clipping_varying
    #include assign_size

    mat4 modelTransform = uModel * aTransform;

    vTransform = aTransform;
    vStart = (modelTransform * vec4(aStart, 1.0)).xyz;
    vEnd = (modelTransform * vec4(aEnd, 1.0)).xyz;
    vSize = size * aScale;
    vCap = aCap;
    vColorMode = aColorMode;

    vModelPosition = (vStart + vEnd) * 0.5;
    vec3 camDir = -mix(normalize(vModelPosition - uCameraPosition), uCameraDir, uIsOrtho);
    vec3 dir = vEnd - vStart;
    // ensure cylinder 'dir' is pointing towards the camera
    if(dot(camDir, dir) < 0.0) {
        dir = -dir;
    }

    vec3 left = cross(camDir, dir);
    vec3 up = cross(left, dir);
    left = vSize * normalize(left);
    up = vSize * normalize(up);

    // move vertex in object-space from center to corner
    vModelPosition += aMapping.x * dir + aMapping.y * left + aMapping.z * up;

    vec4 mvPosition = uView * vec4(vModelPosition, 1.0);
    vViewPosition = mvPosition.xyz;
    gl_Position = uProjection * mvPosition;

    if (gl_Position.z < -gl_Position.w) {
        mvPosition.z -= 2.0 * (length(vEnd - vStart) + vSize); // avoid clipping
        gl_Position.z = (uProjection * mvPosition).z;
    }

    #include clip_instance
}
`;
