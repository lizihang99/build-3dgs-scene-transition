export interface TransitionSceneSpec {
  url: string;
  position: [number, number, number];
  rotationDeg: [number, number, number];
  scale: number;
  accent: string;
  wind: [number, number, number];
}

export const OUTGOING_SCENE: TransitionSceneSpec = {
  url: "/scenes/outgoing.spz",
  position: [0, 3.15, -3],
  rotationDeg: [180, 0, 0],
  scale: 3,
  accent: "#f2a66d",
  wind: [-0.9, 0.18, 0.06]
};

export const INCOMING_SCENE: TransitionSceneSpec = {
  url: "/scenes/incoming.spz",
  position: [0, 3.15, -3],
  rotationDeg: [180, 0, 0],
  scale: 3,
  accent: "#74d7ff",
  wind: [0.75, 0.32, -0.04]
};
