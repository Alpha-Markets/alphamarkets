"use client";

import { useEffect, useRef } from "react";

/// GLSL fbm/simplex "silk" noise field, ported from alphaperp's SilkBackground: a raw WebGL
/// shader (no library deps) instead of HeroAtmosphere's 2D canvas particle field. Scoped to its
/// parent container (the hero section) rather than the viewport, so it only occludes
/// HeroAtmosphere within the hero's bounds.
const vertexShaderSource = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform vec3 u_color;
  uniform float u_intensity;
  uniform float u_scale;
  uniform vec3 u_bgColor;

  // Simplex 2D noise
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m ;
    m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  // Fractal Brownian Motion
  float fbm(vec2 x) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < 4; ++i) {
      v += a * snoise(x);
      x = rot * x * 2.0 + shift;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 st = gl_FragCoord.xy / u_resolution.xy;
    // Fix aspect ratio
    st.x *= u_resolution.x / u_resolution.y;

    vec2 q = vec2(0.);
    q.x = fbm( st * u_scale + 0.00 * u_time);
    q.y = fbm( st * u_scale + vec2(1.0));

    vec2 r = vec2(0.);
    r.x = fbm( st * u_scale + 1.0 * q + vec2(1.7,9.2)+ 0.15 * u_time );
    r.y = fbm( st * u_scale + 1.0 * q + vec2(8.3,2.8)+ 0.126 * u_time);

    float f = fbm(st * u_scale + r);

    // Smooth and remap the noise
    f = smoothstep(0.0, 1.0, f);

    vec3 bg = u_bgColor;

    // Combine colors based on noise
    vec3 color = mix(bg, u_color, clamp(f * u_intensity, 0.0, 1.0));

    // Vignette
    vec2 p = gl_FragCoord.xy / u_resolution.xy;
    float vignette = smoothstep(2.0, 0.4, length(p - 0.5) * 2.0);
    color = mix(bg, color, vignette);

    // Film grain
    float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    color += (noise - 0.5) * 0.04;

    gl_FragColor = vec4(color, 1.0);
  }
`;

function hexToRgb(hex: string, fallback: [number, number, number]): { r: number; g: number; b: number } {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) return { r: fallback[0] / 255, g: fallback[1] / 255, b: fallback[2] / 255 };
  return {
    r: parseInt(match[1], 16) / 255,
    g: parseInt(match[2], 16) / 255,
    b: parseInt(match[3], 16) / 255,
  };
}

function themeHex(varName: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

interface HeroSilkBackgroundProps {
  bgColor?: string;
  color?: string;
  speed?: number;
  intensity?: number;
  scale?: number;
  className?: string;
}

export function HeroSilkBackground({
  bgColor,
  color,
  speed = 0.8,
  intensity = 0.35,
  scale = 2.4,
  className,
}: HeroSilkBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
    });
    if (!gl) {
      console.warn("WebGL not supported");
      return;
    }

    const compileShader = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Shader error:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
    const program = gl.createProgram();
    if (!program || !vertexShader || !fragmentShader) return;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.useProgram(program);

    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const positionLoc = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, "u_resolution");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uColor = gl.getUniformLocation(program, "u_color");
    const uBgColor = gl.getUniformLocation(program, "u_bgColor");
    const uIntensity = gl.getUniformLocation(program, "u_intensity");
    const uScale = gl.getUniformLocation(program, "u_scale");

    const rgbColor = hexToRgb(color ?? themeHex("--color-accent", "#3adbd0"), [58, 219, 208]);
    gl.uniform3f(uColor, rgbColor.r, rgbColor.g, rgbColor.b);
    const bgRgb = hexToRgb(bgColor ?? themeHex("--color-ground", "#0b1211"), [11, 18, 17]);
    gl.uniform3f(uBgColor, bgRgb.r, bgRgb.g, bgRgb.b);
    gl.uniform1f(uIntensity, intensity);
    gl.uniform1f(uScale, scale);

    let animationFrameId: number;
    let startTime = performance.now();

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Sized to the hero container, not the viewport, so the shader stays scoped to the hero
    // section (HeroAtmosphere keeps covering the rest of the page behind it).
    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      const width = rect?.width ?? window.innerWidth;
      const height = rect?.height ?? window.innerHeight;
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
    };

    const render = (time: number) => {
      if (!prefersReducedMotion) {
        const elapsedTime = (time - startTime) * 0.0005 * speed;
        gl.uniform1f(uTime, elapsedTime);
      }

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      if (document.visibilityState === "visible" && !prefersReducedMotion) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !prefersReducedMotion) {
        const currentTime =
          typeof gl.getUniform(program, uTime as WebGLUniformLocation) === "number"
            ? (gl.getUniform(program, uTime as WebGLUniformLocation) as number)
            : 0;
        startTime = performance.now() - currentTime / (0.0005 * speed);
        animationFrameId = requestAnimationFrame(render);
      } else {
        cancelAnimationFrame(animationFrameId);
      }
    };

    let resizeTimeout: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(resize, 100);
    };

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibilityChange);

    resize();
    render(performance.now());

    return () => {
      cancelAnimationFrame(animationFrameId);
      clearTimeout(resizeTimeout);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      gl.deleteProgram(program);
    };
  }, [bgColor, color, speed, intensity, scale]);

  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 z-0 overflow-hidden ${className ?? ""}`}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
