import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshAccessToken } from "@/lib/microsoft-graph";

export interface OneDriveFile {
  id:   string;
  name: string;
  path: string;
  size: number;
  lastModified: string;
}

const GRAPH = "https://graph.microsoft.com/v1.0";

async function graphGet(accessToken: string, url: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function collectExcelFiles(
  accessToken: string,
  folderUrl: string,
  depth = 0
): Promise<OneDriveFile[]> {
  if (depth > 2) return []; // max 3 levels deep

  const data = await graphGet(
    accessToken,
    `${folderUrl}?$select=id,name,parentReference,size,lastModifiedDateTime,file,folder&$top=200`
  );
  if (!data?.value) return [];

  const files: OneDriveFile[] = [];

  for (const item of data.value) {
    if (item.file && item.name.toLowerCase().endsWith(".xlsx")) {
      files.push({
        id:           item.id,
        name:         item.name,
        path:         buildPath(item.parentReference?.path, item.name),
        size:         item.size,
        lastModified: item.lastModifiedDateTime,
      });
    } else if (item.folder && depth < 2) {
      // Recurse into subfolders
      const sub = await collectExcelFiles(
        accessToken,
        `${GRAPH}/me/drive/items/${item.id}/children`,
        depth + 1
      );
      files.push(...sub);
    }
  }

  return files;
}

function buildPath(parentPath: string | undefined, name: string): string {
  const cleaned = (parentPath ?? "").replace(/^.*\/root:/, "").replace(/^\/+/, "");
  return cleaned ? `${cleaned}/${name}` : name;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: conn } = await supabase
      .from("microsoft_connections")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!conn) return NextResponse.json({ connected: false });

    let accessToken = conn.access_token;
    if (new Date(conn.expires_at) < new Date(Date.now() + 60_000)) {
      const refreshed = await refreshAccessToken(conn.refresh_token);
      accessToken = refreshed.access_token;
      await supabase.from("microsoft_connections").update({
        access_token:  refreshed.access_token,
        refresh_token: refreshed.refresh_token ?? conn.refresh_token,
        expires_at:    new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        updated_at:    new Date().toISOString(),
      }).eq("user_id", user.id);
    }

    // Scan from root + special Documents folder (most reliable for personal accounts)
    const [rootFiles, docsFiles] = await Promise.all([
      collectExcelFiles(accessToken, `${GRAPH}/me/drive/root/children`),
      collectExcelFiles(accessToken, `${GRAPH}/me/drive/special/documents/children`),
    ]);
    const files = [...rootFiles, ...docsFiles];

    // Deduplicate and sort by most recently modified
    const seen = new Set<string>();
    const unique = files.filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });

    unique.sort(
      (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
    );

    return NextResponse.json({ connected: true, files: unique });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
