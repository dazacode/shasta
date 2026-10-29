import type { CSSProperties } from 'react'

/**
 * The glossy ribbon wallpaper for the new tab page: deep navy with glossy diagonal ribbons in violet and electric blue.
 * Layered CSS gradients only (nothing is downloaded).
 */
const Ribbon = ({ style }: { style: CSSProperties }) => <div className="nt-ribbon" style={style} aria-hidden />

export function RibbonWallpaper() {
  return (
    <div className="nt-wall" aria-hidden>
      <div className="absolute inset-0" style={{ background: 'radial-gradient(70% 60% at 50% 40%, #0d0b2a 0%, #060616 70%, #04040d 100%)' }} />
      {/* top-left violet blade */}
      <Ribbon style={{ top: '-20%', left: '-4%', width: '16%', height: '90%', transform: 'rotate(-32deg)', transformOrigin: 'top left', background: 'linear-gradient(90deg, #3b2a7a 0%, #a779ff 38%, #d9c2ff 52%, #5a3fb8 80%, transparent)', opacity: 0.66 }} />
      <Ribbon style={{ top: '-30%', left: '14%', width: '5%', height: '80%', transform: 'rotate(-32deg)', transformOrigin: 'top left', background: 'linear-gradient(90deg, transparent, #8b5cf6 60%, #c9b0ff)', opacity: 0.39 }} />
      {/* top-right blue glass */}
      <Ribbon style={{ top: '-25%', right: '-6%', width: '34%', height: '110%', transform: 'rotate(28deg)', transformOrigin: 'top right', background: 'linear-gradient(100deg, transparent 5%, #3b4fb4 28%, #9bb7ff 46%, #e1ecff 52%, #6f8bf0 66%, #3d4eb0 100%)', opacity: 0.64 }} />
      <Ribbon style={{ top: '-10%', right: '22%', width: '4%', height: '60%', transform: 'rotate(28deg)', transformOrigin: 'top right', background: 'linear-gradient(90deg, transparent, #a78bfa, transparent)', opacity: 0.52 }} />
      {/* left glow edge */}
      <Ribbon style={{ top: '42%', left: '-6%', width: '18%', height: '54%', transform: 'rotate(-18deg)', background: 'linear-gradient(180deg, transparent, #7c4dff 35%, #cfa8ff 55%, #5b34c8 80%, transparent)', opacity: 0.56, filter: 'blur(3px)' }} />
      {/* bottom blades */}
      <Ribbon style={{ bottom: '-24%', left: '20%', width: '20%', height: '70%', transform: 'rotate(-35deg)', transformOrigin: 'bottom left', background: 'linear-gradient(90deg, #2c2468, #9a7dff 45%, #d6c4ff 55%, #4a3a9c)', opacity: 0.63 }} />
      <Ribbon style={{ bottom: '-30%', right: '8%', width: '26%', height: '70%', transform: 'rotate(35deg)', transformOrigin: 'bottom right', background: 'linear-gradient(90deg, #2a3a8c, #7894f0 45%, #cfe0ff 55%, #3b4cb0)', opacity: 0.59 }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(55% 50% at 50% 52%, rgb(6 6 22 / 0.92), rgb(6 6 22 / 0.6) 55%, transparent 100%)' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(90% 80% at 50% 50%, transparent 40%, rgb(3 3 12 / 0.55) 100%)' }} />
    </div>
  )
}
