"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, EyeOff, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";

export function SetupForm() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
  });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to initialize standard admin.");
      }

      // Success! Send them to login
      router.push("/admin/login?setup=success");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-xl shadow-2xl">
      <CardHeader className="space-y-1 pb-6">
        <CardTitle className="text-xl text-white">Super Admin Details</CardTitle>
        <CardDescription className="text-slate-400">
          This account will have permanent, irrevocable access to all system features.
        </CardDescription>
      </CardHeader>
      
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}
          
          <div className="space-y-2">
            <Label className="text-slate-300" htmlFor="name">Full Name</Label>
            <Input 
              id="name"
              required 
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              className="bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500" 
              placeholder="System Administrator" 
            />
          </div>
          
          <div className="space-y-2">
            <Label className="text-slate-300" htmlFor="email">Email Address</Label>
            <Input 
              id="email"
              type="email" 
              required 
              value={formData.email}
              onChange={(e) => setFormData({...formData, email: e.target.value})}
              className="bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500" 
              placeholder="admin@startup.com" 
            />
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300" htmlFor="password">Secure Password</Label>
            <div className="relative">
              <Input 
                id="password"
                type={showPassword ? "text" : "password"} 
                required
                minLength={8}
                value={formData.password}
                onChange={(e) => setFormData({...formData, password: e.target.value})}
                className="bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 pr-10" 
                placeholder="••••••••" 
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </CardContent>

        <CardFooter className="pt-4">
          <Button 
            type="submit" 
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
            disabled={isLoading || !formData.email || !formData.password || !formData.name}
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4 mr-2" />
            )}
            Initialize System
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
