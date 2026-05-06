import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-8">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Em construção. Esta tela será implementada nas próximas etapas.
        </CardContent>
      </Card>
    </div>
  );
}