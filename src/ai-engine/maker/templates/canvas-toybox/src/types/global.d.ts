declare global {
  interface Window {
    DREAM_ASSETS: Record<string, string>;
    DREAM_ASSET_PACK: any[];
    DREAM_IMAGES: Record<string, HTMLImageElement>;
    DREAM_ANIMATIONS: any[];
    DREAM_TILESETS: any[];
    DreamAssets: {
      addSprite(scene: any, x: number, y: number, roleOrKey: string): any;
      getImage(roleOrKey: string): string | null;
      firstByRole(role: string): any;
      preloadPhaser(scene: any): void;
      animationsFor(role: string): any[];
      createAnimations(scene: any, role: string): string[];
      applyTween(scene: any, target: any, role: string): void;
      getTileset(role: string): any;
      firstTileset(): any;
    };
  }
}

export {};