'use client';

import { Upload } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function ImportPage() {
  return (
    <div className="flex-1 p-6 lg:p-8 w-full">
      <Card className="border-0 shadow-soft">
        <CardContent className="p-10 grid place-items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 grid place-items-center mb-4">
            <Upload className="h-6 w-6 text-indigo-600" />
          </div>
          <div className="text-base font-semibold text-slate-800">Import bo'limi</div>
          <div className="text-[12px] text-slate-500 mt-1 max-w-md">
            Qanday import qilish kerakligini ayting — shu yerga forma yoki tugmalar qo'shamiz.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
