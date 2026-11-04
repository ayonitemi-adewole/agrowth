import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

// Money is bigint kobo internally; send it to clients as a decimal string so no precision is lost.
declare global {
  interface BigInt {
    toJSON(): string;
  }
}
BigInt.prototype.toJSON = function (this: bigint) {
  return this.toString();
};

/** Shared by main.ts and the end-to-end tests so both run the same app configuration. */
export function setupApp(app: INestApplication, options: { swagger?: boolean } = {}): void {
  app.use(helmet());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  if (options.swagger) {
    const config = new DocumentBuilder()
      .setTitle('Agrowth API')
      .setDescription('Core API for the Agrowth agricultural finance platform')
      .setVersion('2.0.0-alpha')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }
}
