// import { Injectable } from '@angular/core';
// import { HttpClient, HttpHeaders } from '@angular/common/http';

// @Injectable({ providedIn: 'root' })
// export class ApiService {
//   constructor(private http: HttpClient) {}
//   post<T>(url: string, body: any, headers?: HttpHeaders) {
//     return this.http.post<T>(url, body, { headers });
//   }
//   get<T>(url: string) {
//     return this.http.get<T>(url);
//   }
// }

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
//import { environment } from '../environments/environment'; // AJUSTA la ruta si estás en otra carpeta
import { environment } from '../environments/environment.prod'; 

@Injectable({ providedIn: 'root' })
export class ApiService {
  private baseUrl = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  post<T>(url: string, body: any, headers?: HttpHeaders) {
    const fullUrl = url.startsWith('http')
      ? url
      : this.baseUrl + url;

    console.log('[ApiService] POST ->', fullUrl);  // 🔴 línea clave

    return this.http.post<T>(fullUrl, body, { headers });
  }

  get<T>(url: string) {
    const fullUrl = url.startsWith('http')
      ? url
      : this.baseUrl + url;

    console.log('[ApiService] GET ->', fullUrl);

    return this.http.get<T>(fullUrl);
  }
}
