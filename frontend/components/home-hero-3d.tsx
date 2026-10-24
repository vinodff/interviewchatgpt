"use client";

import { useRef, type ReactNode } from "react";
import { motion, useMotionValue, useScroll, useSpring, useTransform } from "framer-motion";
import { AudioLines, Code2, FileText, Mic, ShieldCheck, Sparkles } from "lucide-react";

/**
 * Premium hero stage: scroll-linked 3D tilt + mouse tilt + floating icon
 * chips. Deliberately CSS/framer transforms only — no WebGL — so the
 * interview page stays fast on phones. Respects reduced motion: the
 * wrapper renders children unchanged when the user prefers it.
 */
const FLOATERS = [
  { Icon: Mic, label: "Live mic", className: "floater-left" },
  { Icon: FileText, label: "Your resume", className: "floater-right" },
  { Icon: Code2, label: "Your projects", className: "floater-bottom-left" },
  { Icon: ShieldCheck, label: "With permission", className: "floater-bottom-right" },
  { Icon: Sparkles, label: "Clear answers", className: "floater-top" },
];

export function HomeHero3D({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const scrollRotateX = useTransform(scrollYProgress, [0, 1], [8, -4]);
  const scrollY = useTransform(scrollYProgress, [0, 1], [0, -40]);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [6, -6]), { stiffness: 120, damping: 18 });
  const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-7, 7]), { stiffness: 120, damping: 18 });

  function onMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    mouseX.set((event.clientX - rect.left) / rect.width - 0.5);
    mouseY.set((event.clientY - rect.top) / rect.height - 0.5);
  }
  function onMouseLeave() { mouseX.set(0); mouseY.set(0); }

  return <div ref={ref} className="home-hero-3d" onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}>
    <motion.div style={{ rotateX: scrollRotateX, y: scrollY, transformStyle: "preserve-3d" }}>
      <motion.div style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}>
        {children}
      </motion.div>
    </motion.div>
    <div className="home-floaters" aria-hidden="true">
      {FLOATERS.map(({ Icon, label, className }, index) => (
        <motion.span key={label} className={`home-floater ${className}`} style={{ transform: "translateZ(60px)" }}
          animate={{ y: [0, -12, 0], rotate: [0, index % 2 ? 3 : -3, 0] }}
          transition={{ duration: 4.5 + index * 0.7, repeat: Infinity, ease: "easeInOut" }}>
          <Icon size={17} /><span>{label}</span>
        </motion.span>
      ))}
      <motion.span className="home-floater home-floater-audio" aria-hidden="true" animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}>
        <AudioLines size={17} /><span>Listening live</span>
      </motion.span>
    </div>
  </div>;
}
