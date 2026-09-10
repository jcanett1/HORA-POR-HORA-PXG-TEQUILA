import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type UserAction = "list" | "create" | "update";

type RequestBody = {
  action: UserAction;
  user_id?: string;
  email?: string;
  password?: string;
  nombre_completo?: string;
  numero_empleado?: string | null;
  rol?: "operador" | "supervisor" | "administrador";
  planta?: string;
  area?: string;
  celda?: "CELDA 16" | "CELDA 15" | "CELDA 11" | "CELDA 10" | null;
  activo?: boolean;
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Método no permitido." }, 405);

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization || !supabaseUrl || !anonKey || !serviceRoleKey) {
    return response({ error: "La función no está configurada correctamente." }, 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return response({ error: "Sesión no válida." }, 401);

  const { data: actor, error: actorError } = await adminClient
    .from("perfiles_usuarios")
    .select("rol, activo")
    .eq("id", userData.user.id)
    .single();
  if (actorError || !actor?.activo || actor.rol !== "administrador") {
    return response({ error: "Solo un administrador puede administrar usuarios." }, 403);
  }

  let payload: RequestBody;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "El cuerpo de la solicitud no es JSON válido." }, 400);
  }

  if (payload.action === "list") {
    const { data: authUsers, error: listError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) return response({ error: listError.message }, 400);

    const ids = authUsers.users.map((user) => user.id);
    const { data: profiles, error: profilesError } = ids.length
      ? await adminClient.from("perfiles_usuarios").select("*").in("id", ids)
      : { data: [], error: null };
    if (profilesError) return response({ error: profilesError.message }, 400);

    const profilesById = new Map((profiles || []).map((profile) => [profile.id, profile]));
    return response({
      users: authUsers.users.map((user) => ({
        ...profilesById.get(user.id),
        id: user.id,
        email: user.email || "",
        last_sign_in_at: user.last_sign_in_at || null,
      })),
    });
  }

  const fullName = payload.nombre_completo?.trim();
  if (!fullName) return response({ error: "El nombre completo es obligatorio." }, 400);

  if (payload.action === "create") {
    if (!payload.email?.trim() || !payload.password || payload.password.length < 8) {
      return response({ error: "Correo y contraseña de al menos 8 caracteres son obligatorios." }, 400);
    }

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email: payload.email.trim().toLowerCase(),
      password: payload.password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        numero_empleado: payload.numero_empleado || null,
      },
    });
    if (createError || !created.user) return response({ error: createError?.message || "No fue posible crear el usuario." }, 400);

    const { data: profile, error: profileError } = await adminClient
      .from("perfiles_usuarios")
      .update({
        nombre_completo: fullName,
        numero_empleado: payload.numero_empleado || null,
        rol: payload.rol || "operador",
        planta: payload.planta || "Monterrey",
        area: payload.area || "Produccion",
        celda: payload.celda || null,
        activo: payload.activo ?? true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", created.user.id)
      .select("*")
      .single();

    if (profileError) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      return response({ error: profileError.message }, 400);
    }
    return response({ user: created.user, profile });
  }

  if (payload.action === "update") {
    if (!payload.user_id) return response({ error: "Falta user_id." }, 400);
    const authUpdate: { email?: string; user_metadata?: Record<string, unknown> } = {
      user_metadata: { full_name: fullName, numero_empleado: payload.numero_empleado || null },
    };
    if (payload.email?.trim()) authUpdate.email = payload.email.trim().toLowerCase();

    const { data: updatedAuth, error: authError } = await adminClient.auth.admin.updateUserById(payload.user_id, authUpdate);
    if (authError) return response({ error: authError.message }, 400);

    const { data: profile, error: profileError } = await adminClient
      .from("perfiles_usuarios")
      .update({
        nombre_completo: fullName,
        numero_empleado: payload.numero_empleado || null,
        rol: payload.rol || "operador",
        planta: payload.planta || "Monterrey",
        area: payload.area || "Produccion",
        celda: payload.celda || null,
        activo: payload.activo ?? true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payload.user_id)
      .select("*")
      .single();

    if (profileError) return response({ error: profileError.message }, 400);
    return response({ user: updatedAuth.user, profile });
  }

  return response({ error: "Acción no soportada." }, 400);
});
