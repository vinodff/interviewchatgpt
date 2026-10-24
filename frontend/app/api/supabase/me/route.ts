import { errorResponse, findOrCreateUser, json, serviceClient, userShape, verifySupabaseUser } from "@/lib/supabase-server";

export async function GET(request: Request) {
  try {
    const authUser = await verifySupabaseUser(request);
    const db = serviceClient();
    const row = await findOrCreateUser(db, authUser);
    return json(await userShape(db, row));
  } catch (error) { return errorResponse(error); }
}
