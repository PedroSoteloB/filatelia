// import { Routes } from '@angular/router';
// import { adminGuard } from './core/guards/admin.guard';

// export const routes: Routes = [
//   // Landing pública como raíz
//   {
//     path: '',
//     loadComponent: () =>
//       import('./features/site/landing/landing.component')
//         .then(m => m.LandingComponent)
//   },

//   {
//     path: 'login',
//     loadComponent: () =>
//       import('./features/auth/login/login.component').then(m => m.LoginComponent)
//   },
//   {
//     path: 'forgot-password',
//     loadComponent: () =>
//       import('./features/auth/forgot-password/forgot-password.component')
//         .then(m => m.ForgotPasswordComponent)
//   },
//   {
//     path: 'reset-password',
//     loadComponent: () =>
//       import('./features/auth/reset-password/reset-password.component')
//         .then(m => m.ResetPasswordComponent)
//   },

//   // Admin (protegido por rol)
//   {
//     path: 'admin',
//     canMatch: [adminGuard],
//     loadComponent: () =>
//       import('./features/admin/admin-landing/landing/landing.component')
//         .then(m => m.LandingComponent)
//   },
  
//   {
//     path: 'admin/roles',
//     canMatch: [adminGuard],
//     loadComponent: () =>
//       import('./features/admin/roles/roles.component')
//         .then(m => m.AdminRolesComponent)
//   },

//   {
//     path: 'app/new',
//     loadComponent: () =>
//       import('./features/site/landing/upload-item/upload-item.component')
//         .then(m => m.UploadItemComponent)
//   }
  

  
// ];

import { Routes } from '@angular/router';
import { adminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  // Landing pública
  {
    path: '',
    loadComponent: () =>
      import('./features/site/landing/landing.component')
        .then(m => m.LandingComponent)
  },

  // Auth
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component')
        .then(m => m.LoginComponent)
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./features/auth/forgot-password/forgot-password.component')
        .then(m => m.ForgotPasswordComponent)
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./features/auth/reset-password/reset-password.component')
        .then(m => m.ResetPasswordComponent)
  },

  // Ruta para subir piezas filatélicas (🔹 PÚBLICA o protegida, tú decides)
  {
    path: 'items/upload',
    loadComponent: () =>
      import('./features/site/functions/upload-item/upload-item.component')
        .then(m => m.UploadItemComponent)
  },

  {
    path: 'items/mine',
    loadComponent: () =>
      import('./features/site/functions/list/my-items.component')
        .then(m => m.MyItemsComponent)
  } ,
  {
    path: 'items/mine/:id',
    loadComponent: () =>
      import('./features/site/functions/item-details/item-details.component')
        .then(m => m.ItemDetailsComponent)
  },
  {
    path: 'items/search',
    loadComponent: () =>
      import('./features/site/functions/item-search/item-search.component')
        .then(m => m.ItemSearchComponent)
  },
  
  {
    path: 'collections',
    loadComponent: () =>
      import('./features/site/functions/collections-list/collections-list.component')
        .then(m => m.CollectionsListComponent)
  },
  {
    path: 'collections/:id',
    loadComponent: () =>
      import('./features/site/functions/collection-detail/collection-detail.component')
        .then(m => m.CollectionDetailComponent)
  }
,  
  {
    path: 'presentations',
    loadComponent: () =>
    import('./features/site/functions/presentations-home/presentations-home.component')
        .then(m => m.PresentationsHomeComponent)
  },

  {
    path: 'presentations/:id',
    loadComponent: () =>
    import('./features/site/functions/presentation-detail/presentation-detail.component')
        .then(m => m.PresentationDetailComponent)
  },
  
  // Admin (protegido por rol)
  {
    path: 'admin',
    canMatch: [adminGuard],
    loadComponent: () =>
      import('./features/admin/admin-landing/landing/landing.component')
        .then(m => m.LandingComponent)
  },
  {
    path: 'admin/roles',
    canMatch: [adminGuard],
    loadComponent: () =>
      import('./features/admin/roles/roles.component')
        .then(m => m.AdminRolesComponent)
  },

  // Fallback
  { path: '**', redirectTo: '' }
];
