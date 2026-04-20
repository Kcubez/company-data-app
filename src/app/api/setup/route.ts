import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    // SECURITY: Only allow this if ZERO users exist in the entire database
    const userCount = await prisma.user.count();
    
    if (userCount > 0) {
      return NextResponse.json(
        { error: "Setup is already locked. Admin already exists." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { name, email, password } = body;

    if (!name || !email || !password) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Use Better Auth's internal API to create the user properly 
    // (This automatically hashes the password and creates the Account link)
    const newAdminResponse = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name,
      },
      asResponse: true,
    });

    if (!newAdminResponse.ok) {
        throw new Error("Failed to create admin user account.");
    }

    // Forcefully elevate this newly created user to admin
    await prisma.user.update({
        where: { email },
        data: { role: "admin" }
    });

    return NextResponse.json({ success: true, message: "Initial Admin created!" });
  } catch (error: any) {
    console.error("Setup Admin Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create initial admin" },
      { status: 500 }
    );
  }
}
