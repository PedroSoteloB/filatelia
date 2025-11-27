import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,            // 👈 IMPORTANTE
  imports: [RouterOutlet],
  template: `<router-outlet />` // 👈 así evitamos template externo
})
export class AppComponent {}
