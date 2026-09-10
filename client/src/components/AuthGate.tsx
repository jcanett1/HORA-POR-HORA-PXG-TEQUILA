import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { ArrowRight, LockKeyhole, PackageCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { getSupabaseConfigMessage, isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/database.types";

export type AuthContextValue = {
  user: User;
  profile: Profile | null;
  liveMode: boolean;
  signOut: () => Promise<void>;
};

export function AuthGate({ children }: { children: (auth: AuthContextValue) => React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let mounted = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user) await loadProfile(data.session.user);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === "SIGNED_IN" && nextSession?.user) void loadProfile(nextSession.user);
      if (event === "SIGNED_OUT") setProfile(null);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function loadProfile(user: User) {
    if (!supabase) return;
    const { data, error } = await supabase.from("perfiles_usuarios").select("*").eq("id", user.id).maybeSingle();
    if (error) {
      toast.error(`No se pudo cargar el perfil: ${error.message}`);
      return;
    }
    setProfile(data as Profile | null);
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }

  if (!isSupabaseConfigured) {
    const demoUser = { id: "demo-user", email: "demo@pxgtequila.local" } as User;
    return <>{children({ user: demoUser, profile: null, liveMode: false, signOut })}</>;
  }

  if (loading) return <LoadingScreen />;
  if (!session?.user) return <LoginScreen />;
  if (profile && !profile.activo) return <InactiveScreen signOut={signOut} />;

  return <>{children({ user: session.user, profile, liveMode: true, signOut })}</>;
}

function LoadingScreen() {
  return <div className="flex min-h-screen items-center justify-center bg-[#f4f7f8]"><div className="soft-card flex items-center gap-3 px-5 py-4 text-sm font-semibold text-slate-600"><div className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-600 border-t-transparent" />Cargando sesión segura…</div></div>;
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (!email || !password) {
      toast.error("Ingresa correo y contraseña.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) toast.error(error.message);
  }

  return <div className="min-h-screen bg-[#f4f7f8] px-4 py-8"><div className="industrial-grid fixed inset-0 pointer-events-none opacity-45" /><div className="relative mx-auto grid min-h-[calc(100vh-4rem)] max-w-5xl items-center gap-8 lg:grid-cols-[1.05fr_.95fr] "><div className="hidden lg:block"><div className="flex items-center gap-3"><div className="logo-mark"><PackageCheck className="h-5 w-5" /></div><div><p className="font-display text-lg font-semibold tracking-tight text-slate-950">PXG TEQUILA</p><p className="text-[10px] font-bold uppercase tracking-[.18em] text-cyan-700">Registro de accesorios</p></div></div><p className="mt-10 max-w-md font-display text-5xl font-semibold leading-[1.05] tracking-tight text-slate-950">Cada captura. Cada salida. Una trazabilidad clara.</p><p className="mt-6 max-w-md text-sm leading-6 text-slate-500">Valida órdenes, números de parte y SH contra tu documento maestro y deja una bitácora lista para supervisión.</p><div className="mt-9 grid max-w-md grid-cols-2 gap-3"><div className="soft-card p-4"><ShieldCheck className="h-5 w-5 text-emerald-600" /><p className="mt-4 text-xs font-bold text-slate-800">Match controlado</p><p className="mt-1 text-xs leading-5 text-slate-500">La validación vive en la base de datos.</p></div><div className="soft-card p-4"><LockKeyhole className="h-5 w-5 text-cyan-700" /><p className="mt-4 text-xs font-bold text-slate-800">Acceso por rol</p><p className="mt-1 text-xs leading-5 text-slate-500">Operador, supervisor y administrador.</p></div></div></div><div className="soft-card relative mx-auto w-full max-w-md overflow-hidden p-6 sm:p-8"><div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cyan-500 to-emerald-400" /><div className="lg:hidden"><div className="flex items-center gap-3"><div className="logo-mark"><PackageCheck className="h-5 w-5" /></div><div><p className="font-display text-lg font-semibold tracking-tight text-slate-950">PXG TEQUILA</p><p className="text-[10px] font-bold uppercase tracking-[.18em] text-cyan-700">Registro de accesorios</p></div></div></div><div className="mt-8 lg:mt-0"><p className="eyebrow">Acceso seguro</p><h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-slate-950">Inicia sesión</h1><p className="mt-2 text-sm leading-6 text-slate-500">Usa tu cuenta de Supabase Auth para entrar al control operativo.</p></div><form onSubmit={submit} className="mt-7 space-y-4"><div><label className="field-label" htmlFor="auth-email">Correo electrónico</label><input id="auth-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="field-input" placeholder="nombre@empresa.com" /></div><div><label className="field-label" htmlFor="auth-password">Contraseña</label><input id="auth-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="field-input" placeholder="••••••••" /></div><button disabled={loading} className="primary-action w-full justify-center">{loading ? "Validando…" : "Entrar al sistema"}<ArrowRight className="h-4 w-4" /></button></form><button onClick={() => setShowDemo((value) => !value)} className="mt-5 w-full text-center text-xs font-bold text-slate-500 hover:text-cyan-700">¿Solo quieres revisar el prototipo?</button>{showDemo ? <p className="mt-3 rounded-xl border border-cyan-100 bg-cyan-50 px-3 py-2 text-xs leading-5 text-cyan-800">Para modo demo elimina temporalmente las variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en tu entorno local.</p> : null}</div></div></div>;
}

function InactiveScreen({ signOut }: { signOut: () => Promise<void> }) {
  return <div className="flex min-h-screen items-center justify-center bg-[#f4f7f8] px-4"><div className="soft-card max-w-md p-7 text-center"><LockKeyhole className="mx-auto h-8 w-8 text-amber-600" /><h1 className="mt-4 font-display text-xl font-semibold text-slate-900">Cuenta inactiva</h1><p className="mt-2 text-sm leading-6 text-slate-500">Tu usuario existe, pero un administrador debe activar tu perfil antes de usar PXG TEQUILA.</p><button onClick={() => void signOut()} className="secondary-action mx-auto mt-5">Cerrar sesión</button></div></div>;
}
