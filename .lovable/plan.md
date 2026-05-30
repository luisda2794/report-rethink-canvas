## Diagnóstico

Hay 2 perfiles en la base de datos y los dos tienen `role = jefe_flota`:

- `ldsequeira27@gmail.com` — creado el 28/05 (antes de la lógica de "primer usuario = admin")
- `sendilydeliverypl@gmail.com` (Luis) — creado hoy

Por eso no puedes crear más usuarios: `/admin` requiere `role = admin`, y la política RLS `Admin or self insert profile` solo deja insertar perfiles ajenos a un admin.

## Plan

1. Actualizar el perfil de `sendilydeliverysl@gmail.com` (la cuenta con la que acabas de iniciar sesión) a `role = 'admin'`.
2. Cerrar sesión y volver a entrar para que el `AuthContext` recargue el rol.
3. Ya podrás entrar a `/admin` y crear hubs y usuarios.

Si prefieres que el admin sea `ldsequeira27@gmail.com`, dímelo y promociono ese en su lugar.

## Detalle técnico

```sql
UPDATE public.profiles
SET role = 'admin'
WHERE id = '5a1f8ec6-a5cd-4c5a-ae6d-e13d9db0634d';
```

Sin cambios de código ni de esquema.